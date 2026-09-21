import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  TerminalFontSettings,
  TerminalSessionInfo,
  TerminalShellInfo,
} from "@zen/shared";
import { useWorkspaceStore } from "@/stores/workspace";

/** 分屏：none=单栏；columns=左右；rows=上下 */
export type TerminalSplitMode = "none" | "columns" | "rows";

const fallbackFont: TerminalFontSettings = {
  fontFamily:
    '"MesloLGS NF", "0xProto Nerd Font", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  primaryFamily: "MesloLGS NF",
  source: "fallback",
  isNerdFont: true,
};

export const useTerminalStore = defineStore("terminal", () => {
  const shellInfo = ref<TerminalShellInfo | null>(null);
  const fontInfo = ref<TerminalFontSettings>(fallbackFont);
  const sessions = ref<TerminalSessionInfo[]>([]);
  const activeId = ref("");
  /** 自定义名称（按会话）；未命名时用 shell + 序号 */
  const names = ref<Record<string, string>>({});
  /** 分屏布局：pane 槽位对应 sessionId */
  const splitMode = ref<TerminalSplitMode>("none");
  const paneIds = ref<string[]>([]);
  const buffers = new Map<string, string>();
  const error = ref("");

  const shellLabel = computed(
    () => shellInfo.value?.label || shellInfo.value?.path || "系统默认 shell",
  );
  const session = computed(
    () => sessions.value.find((item) => item.id === activeId.value) ?? null,
  );
  const sessionId = computed(() => activeId.value);
  const buffer = computed(() => buffers.get(activeId.value) || "");
  const ready = computed(() => sessions.value.length > 0);
  /** 当前可见 pane 中的会话（分屏时 2 个，单栏时 1 个） */
  const visibleSessions = computed(() => {
    if (splitMode.value === "none" || !paneIds.value.length) {
      return activeId.value
        ? sessions.value.filter((item) => item.id === activeId.value)
        : sessions.value.slice(0, 1);
    }
    return paneIds.value
      .map((id) => sessions.value.find((item) => item.id === id))
      .filter((item): item is TerminalSessionInfo => Boolean(item));
  });

  function getBuffer(id: string): string {
    return buffers.get(id) || "";
  }

  function displayName(id: string, fallbackIndex?: number): string {
    const custom = names.value[id]?.trim();
    if (custom) {
      return custom;
    }
    const index =
      fallbackIndex ?? sessions.value.findIndex((item) => item.id === id);
    const info = sessions.value.find((item) => item.id === id);
    const shellName = info?.shell.split("/").pop() || "sh";
    return `${(index < 0 ? 0 : index) + 1}: ${shellName}`;
  }

  function rename(id: string, name: string) {
    const trimmed = name.trim();
    names.value = { ...names.value, [id]: trimmed };
  }

  function appendData(id: string, data: string) {
    const prev = buffers.get(id) || "";
    const next = prev.length > 200_000 ? `${prev.slice(-150_000)}${data}` : `${prev}${data}`;
    buffers.set(id, next);
  }

  function removeFromPanes(id: string) {
    paneIds.value = paneIds.value.filter((item) => item !== id);
    if (paneIds.value.length <= 1) {
      splitMode.value = "none";
      if (paneIds.value[0]) {
        activeId.value = paneIds.value[0];
      }
    }
  }

  function bindEvents() {
    const zen = window.zen;
    if (!zen?.terminal) {
      return () => undefined;
    }
    const offData = zen.terminal.onData((event) => {
      appendData(event.sessionId, event.data);
    });
    const offExit = zen.terminal.onExit((event) => {
      appendData(event.sessionId, `\n[进程已退出 exit=${event.exitCode}]\n`);
      sessions.value = sessions.value.filter((item) => item.id !== event.sessionId);
      removeFromPanes(event.sessionId);
      if (activeId.value === event.sessionId) {
        const rest = sessions.value;
        activeId.value = rest[0]?.id ?? "";
        if (splitMode.value === "none") {
          paneIds.value = activeId.value ? [activeId.value] : [];
        }
        if (!rest.length) {
          void start();
        }
      }
    });
    return () => {
      offData();
      offExit();
    };
  }

  async function loadShell() {
    if (!window.zen?.terminal) {
      return;
    }
    shellInfo.value = await window.zen.terminal.shell();
  }

  /** 读取系统终端字体（VS Code / iTerm / Terminal.app），并带 Nerd Font 回退 */
  async function loadFont() {
    if (!window.zen?.terminal?.font) {
      return;
    }
    try {
      const result = await window.zen.terminal.font();
      if (result?.fontFamily) {
        fontInfo.value = result;
      }
    } catch {
      // 保留 fallback
    }
  }

  async function start(cwd?: string, cols = 80, rows = 24) {
    if (!window.zen?.terminal) {
      error.value = "终端 IPC 不可用";
      return;
    }
    error.value = "";
    await loadShell();
    await loadFont();
    const workspace = useWorkspaceStore();
    const workdir = cwd || workspace.activePath || undefined;
    const result = await window.zen.terminal.create({
      cwd: workdir,
      cols,
      rows,
    });
    if (!result.ok || !result.session) {
      error.value = result.error || "终端启动失败";
      return;
    }
    const created = result.session;
    sessions.value = [...sessions.value, created];
    buffers.set(created.id, "");
    activeId.value = created.id;
    if (splitMode.value === "none") {
      paneIds.value = [created.id];
    } else {
      // 分屏中新建：替换当前活动 pane
      const index = paneIds.value.indexOf(activeId.value);
      if (index >= 0) {
        paneIds.value = paneIds.value.map((id, i) => (i === index ? created.id : id));
      } else if (paneIds.value.length < 2) {
        paneIds.value = [...paneIds.value, created.id];
      } else {
        paneIds.value = [paneIds.value[0]!, created.id];
      }
    }
  }

  /** 水平/垂直分屏：在相邻 pane 新建终端 */
  async function split(direction: "columns" | "rows") {
    const current = activeId.value || sessions.value[0]?.id;
    if (!current) {
      await start();
      if (!activeId.value) {
        return;
      }
    }
    const baseId = activeId.value;
    if (!baseId) {
      return;
    }
    if (splitMode.value === direction && paneIds.value.length >= 2) {
      return;
    }
    await start();
    const created = activeId.value;
    if (!created) {
      return;
    }
    splitMode.value = direction;
    paneIds.value = [baseId, created];
  }

  /** 取消分屏：保留活动终端为单栏，其它会话仍在 Tab 列表 */
  function unsplit() {
    splitMode.value = "none";
    if (activeId.value) {
      paneIds.value = [activeId.value];
    } else if (sessions.value[0]) {
      activeId.value = sessions.value[0].id;
      paneIds.value = [activeId.value];
    } else {
      paneIds.value = [];
    }
  }

  function setActive(id: string) {
    if (sessions.value.some((item) => item.id === id)) {
      activeId.value = id;
      if (splitMode.value === "none") {
        paneIds.value = [id];
      } else if (!paneIds.value.includes(id)) {
        // 分屏时点击其它 Tab：替换活动 pane
        const activeInPane = paneIds.value.findIndex((pid) => pid === activeId.value);
        if (activeInPane >= 0 && paneIds.value.length === 2) {
          paneIds.value = paneIds.value.map((pid, i) => (i === activeInPane ? id : pid));
        } else {
          paneIds.value = [paneIds.value[0] || id, id];
        }
      }
    }
  }

  async function write(data: string, id = activeId.value) {
    if (!window.zen?.terminal || !id) {
      return;
    }
    await window.zen.terminal.write(id, data);
  }

  async function resize(cols: number, rows: number, id = activeId.value) {
    if (!window.zen?.terminal || !id) {
      return;
    }
    await window.zen.terminal.resize(id, cols, rows);
  }

  async function restart(cwd?: string) {
    const id = activeId.value;
    if (id && window.zen?.terminal) {
      await window.zen.terminal.kill(id);
      sessions.value = sessions.value.filter((item) => item.id !== id);
      buffers.delete(id);
      removeFromPanes(id);
    }
    await start(cwd);
  }

  async function close(id: string) {
    if (!window.zen?.terminal || !id) {
      return;
    }
    await window.zen.terminal.kill(id);
    buffers.delete(id);
    const nextNames = { ...names.value };
    delete nextNames[id];
    names.value = nextNames;
    const index = sessions.value.findIndex((item) => item.id === id);
    sessions.value = sessions.value.filter((item) => item.id !== id);
    removeFromPanes(id);
    if (activeId.value === id) {
      const neighbor = sessions.value[Math.min(index, sessions.value.length - 1)];
      activeId.value = neighbor?.id ?? "";
      if (splitMode.value === "none") {
        paneIds.value = activeId.value ? [activeId.value] : [];
      }
      if (!sessions.value.length) {
        await start();
      }
    }
  }

  async function openExternal() {
    if (!window.zen?.terminal) {
      return { ok: false, error: "终端 IPC 不可用" };
    }
    const workspace = useWorkspaceStore();
    return window.zen.terminal.openExternal(workspace.activePath || undefined);
  }

  return {
    shellInfo,
    fontInfo,
    sessions,
    session,
    sessionId,
    activeId,
    shellLabel,
    buffer,
    error,
    ready,
    names,
    splitMode,
    paneIds,
    visibleSessions,
    getBuffer,
    displayName,
    rename,
    bindEvents,
    loadShell,
    loadFont,
    start,
    split,
    unsplit,
    setActive,
    write,
    resize,
    restart,
    close,
    openExternal,
  };
});
