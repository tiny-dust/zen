import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useAppTheme } from "@/composables/useAppTheme";
import { openAppLink } from "@/lib/open-link";
import { useTerminalStore } from "@/stores/terminal";

type TermEntry = { term: Terminal; fit: FitAddon; host: HTMLElement; onFocus: () => void };

// 两个面板各持有自己的 xterm DOM；同一 PTY 的尺寸只由最近聚焦的面板同步。
const resizeOwners = new Map<string, TermEntry>();

interface TerminalPanesOptions {
  visibleIds?: () => string[];
}

/**
 * 终端配色统一取全局 Token：xterm 只接受具体色值，无法解析 var()/color-mix()，
 * 因此读计算值并校验格式，读不到时回退到与 Token 等价的内联默认值。
 */
function cssColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^(#|rgb|hsl)/i.test(raw) ? raw : fallback;
}

function terminalTheme() {
  return {
    background: cssColor("--term-bg", "#141414"),
    foreground: cssColor("--term-fg", "#d8d8d4"),
    cursor: cssColor("--term-cursor", "#ff6a2b"),
    selectionBackground: cssColor("--term-selection", "#3a3a3a"),
  };
}

/** 终端 pane 的 xterm 实例生命周期：按可见分屏挂载、适配尺寸、回放缓冲、销毁 */
export function useTerminalPanes(options: TerminalPanesOptions = {}) {
  const terminalStore = useTerminalStore();
  const hostEls = ref(new Map<string, HTMLElement>());
  const entries = new Map<string, TermEntry>();
  const booting = new Map<string, Promise<void>>();
  let ro: ResizeObserver | null = null;
  let unmounted = false;

  function visibleIds(): string[] {
    return options.visibleIds?.() ?? terminalStore.visibleSessions.map((item) => item.id);
  }

  function fitAndResize(id: string, entry: TermEntry) {
    entry.fit.fit();
    if (!resizeOwners.has(id) || resizeOwners.get(id) === entry) {
      resizeOwners.set(id, entry);
      void terminalStore.resize(entry.term.cols, entry.term.rows, id);
    }
  }

  function focusPane(id: string) {
    const entry = entries.get(id);
    if (entry) {
      resizeOwners.set(id, entry);
      fitAndResize(id, entry);
      entry.term.focus();
    }
  }

  // 主题切换就地更新已挂终端配色（xterm options 支持运行时改）
  const { isDark } = useAppTheme();
  watch(isDark, () => {
    const theme = terminalTheme();
    for (const entry of entries.values()) {
      entry.term.options.theme = theme;
    }
  });

  /** 优先系统终端字体（仅内部使用，不在 UI 展示） */
  function fontStack(): string {
    return (
      terminalStore.fontInfo.fontFamily ||
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
      '"MesloLGS NF", "0xProto Nerd Font", Menlo, monospace'
    );
  }

  function fontSizePx(): number {
    return terminalStore.fontInfo.fontSize || 12;
  }

  function setHostRef(id: string, el: unknown) {
    if (el instanceof HTMLElement) {
      hostEls.value.set(id, el);
    } else {
      hostEls.value.delete(id);
    }
  }

  async function createEntry(id: string, host: HTMLElement): Promise<TermEntry | null> {
    const existing = entries.get(id);
    if (existing) {
      disposeEntry(id);
    }
    const term = new Terminal({
      fontFamily: fontStack(),
      fontSize: fontSizePx(),
      // 与等宽排版 Token 一致：行高 1.5
      lineHeight: 1.5,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
      logLevel: "warn",
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try {
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      term.loadAddon(
        new WebLinksAddon((_event, uri) => {
          void openAppLink(uri);
        }),
      );
    } catch {
      // optional
    }
    if (unmounted || hostEls.value.get(id) !== host || !visibleIds().includes(id)) {
      term.dispose();
      return null;
    }
    term.open(host);
    term.onData((data) => {
      void terminalStore.write(data, id);
    });
    const onFocus = () => {
      const entry = entries.get(id);
      if (entry?.host === host) {
        resizeOwners.set(id, entry);
        fitAndResize(id, entry);
      }
    };
    const entry: TermEntry = { term, fit, host, onFocus };
    host.addEventListener("focusin", onFocus);
    entries.set(id, entry);
    const buf = terminalStore.getBuffer(id);
    if (buf) {
      term.write(buf);
    }
    return entry;
  }

  function disposeEntry(id: string) {
    const entry = entries.get(id);
    if (!entry) {
      return;
    }
    ro?.unobserve(entry.host);
    entry.host.removeEventListener("focusin", entry.onFocus);
    if (resizeOwners.get(id) === entry) {
      resizeOwners.delete(id);
    }
    entry.term.dispose();
    entries.delete(id);
  }

  async function mountPane(id: string) {
    if (!id) return;
    const pending = booting.get(id);
    if (pending) return pending;
    const task = doMountPane(id);
    booting.set(id, task);
    try {
      await task;
    } finally {
      booting.delete(id);
      const currentHost = hostEls.value.get(id);
      if (!unmounted && currentHost && visibleIds().includes(id) && entries.get(id)?.host !== currentHost) {
        void mountPane(id);
      }
    }
  }

  async function doMountPane(id: string) {
    await nextTick();
    const host = hostEls.value.get(id);
    if (!host || unmounted) return;
    const existing = entries.get(id);
    if (existing && existing.host === host) {
      fitAndResize(id, existing);
      if (id === terminalStore.activeId && resizeOwners.get(id) === existing) existing.term.focus();
      ro?.observe(host);
      return;
    }
    const entry = await createEntry(id, host);
    if (!entry) return;
    fitAndResize(id, entry);
    if (id === terminalStore.activeId && resizeOwners.get(id) === entry) entry.term.focus();
    ro?.observe(host);
  }

  async function mountVisible() {
    const ids = visibleIds();
    if (!ids.length && terminalStore.activeId) {
      ids.push(terminalStore.activeId);
    }
    for (const id of ids) {
      await mountPane(id);
    }
  }

  /** 观察可见 pane 的尺寸变化：自动 fit 并同步到主进程 */
  function startResizeObserver() {
    ro = new ResizeObserver(() => {
      for (const id of visibleIds()) {
        const entry = entries.get(id);
        if (entry) fitAndResize(id, entry);
      }
    });
  }

  watch(
    () => terminalStore.activeId,
    async () => {
      await mountVisible();
    },
  );
  watch(
    () => terminalStore.splitMode,
    async () => {
      await mountVisible();
    },
  );
  watch(
    () => [visibleIds().join(","), terminalStore.sessions.map((item) => item.id).join(",")],
    async () => {
      const alive = new Set(options.visibleIds ? visibleIds() : terminalStore.sessions.map((item) => item.id));
      for (const id of [...entries.keys()]) {
        if (!alive.has(id)) {
          disposeEntry(id);
          hostEls.value.delete(id);
        }
      }
      await mountVisible();
    },
  );

  onBeforeUnmount(() => {
    unmounted = true;
    ro?.disconnect();
    for (const id of [...entries.keys()]) {
      disposeEntry(id);
    }
  });

  return { entries, setHostRef, mountVisible, disposeEntry, startResizeObserver, focusPane };
}
