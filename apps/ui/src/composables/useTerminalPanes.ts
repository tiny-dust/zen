import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { openAppLink } from "@/lib/open-link";
import { useTerminalStore } from "@/stores/terminal";

type TermEntry = { term: Terminal; fit: FitAddon; host: HTMLElement };

/** 终端 pane 的 xterm 实例生命周期：按可见分屏挂载、适配尺寸、回放缓冲、销毁 */
export function useTerminalPanes() {
  const terminalStore = useTerminalStore();
  const hostEls = ref(new Map<string, HTMLElement>());
  const entries = new Map<string, TermEntry>();
  const booting = new Set<string>();
  let ro: ResizeObserver | null = null;

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

  async function createEntry(id: string, host: HTMLElement): Promise<TermEntry> {
    const existing = entries.get(id);
    if (existing) {
      existing.term.dispose();
      entries.delete(id);
    }
    const term = new Terminal({
      fontFamily: fontStack(),
      fontSize: fontSizePx(),
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
      logLevel: "warn",
      theme: {
        background: "#141414",
        foreground: "#d8d8d4",
        cursor: "#ff6a2b",
        selectionBackground: "#3a3a3a",
      },
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
    term.open(host);
    fit.fit();
    term.onData((data) => {
      void terminalStore.write(data, id);
    });
    const entry: TermEntry = { term, fit, host };
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
    entry.term.dispose();
    entries.delete(id);
  }

  async function mountPane(id: string) {
    if (!id || booting.has(id)) {
      return;
    }
    booting.add(id);
    try {
      await nextTick();
      const host = hostEls.value.get(id);
      if (!host) {
        return;
      }
      const existing = entries.get(id);
      if (existing && existing.host === host) {
        existing.fit.fit();
        void terminalStore.resize(existing.term.cols, existing.term.rows, id);
        if (id === terminalStore.activeId) {
          existing.term.focus();
        }
        ro?.observe(host);
        return;
      }
      const entry = await createEntry(id, host);
      entry.fit.fit();
      void terminalStore.resize(entry.term.cols, entry.term.rows, id);
      if (id === terminalStore.activeId) {
        entry.term.focus();
      }
      ro?.observe(host);
    } finally {
      booting.delete(id);
    }
  }

  async function mountVisible() {
    const ids = terminalStore.visibleSessions.map((item) => item.id);
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
      for (const item of terminalStore.visibleSessions) {
        const entry = entries.get(item.id);
        if (!entry) {
          continue;
        }
        entry.fit.fit();
        void terminalStore.resize(entry.term.cols, entry.term.rows, item.id);
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
    () => terminalStore.visibleSessions.map((item) => item.id).join(","),
    async () => {
      const alive = new Set(terminalStore.sessions.map((item) => item.id));
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
    ro?.disconnect();
    for (const id of [...entries.keys()]) {
      disposeEntry(id);
    }
  });

  return { entries, setHostRef, mountVisible, disposeEntry, startResizeObserver };
}
