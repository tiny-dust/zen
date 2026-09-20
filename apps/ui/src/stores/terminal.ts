import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { TerminalSessionInfo, TerminalShellInfo } from "@zen/shared";
import { useWorkspaceStore } from "@/stores/workspace";

export const useTerminalStore = defineStore("terminal", () => {
  const shellInfo = ref<TerminalShellInfo | null>(null);
  const session = ref<TerminalSessionInfo | null>(null);
  const buffers = new Map<string, string>();
  const sessionId = ref("");
  const error = ref("");
  const ready = ref(false);

  const shellLabel = computed(
    () => shellInfo.value?.label || shellInfo.value?.path || "系统默认 shell",
  );
  const buffer = computed(() => buffers.get(sessionId.value) || "");

  function appendData(id: string, data: string) {
    const prev = buffers.get(id) || "";
    const next = prev.length > 200_000 ? `${prev.slice(-150_000)}${data}` : `${prev}${data}`;
    buffers.set(id, next);
    if (id === sessionId.value) {
      // trigger computed refresh
      sessionId.value = id;
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
      if (event.sessionId === sessionId.value) {
        appendData(event.sessionId, `\n[进程已退出 exit=${event.exitCode}]\n`);
        session.value = null;
        ready.value = false;
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

  async function start(cwd?: string, cols = 80, rows = 24) {
    if (!window.zen?.terminal) {
      error.value = "终端 IPC 不可用";
      return;
    }
    error.value = "";
    await loadShell();
    const workspace = useWorkspaceStore();
    const workdir = cwd || workspace.activePath || undefined;
    const result = await window.zen.terminal.create({
      cwd: workdir,
      cols,
      rows,
    });
    if (!result.ok || !result.session) {
      error.value = result.error || "终端启动失败";
      ready.value = false;
      return;
    }
    session.value = result.session;
    sessionId.value = result.session.id;
    buffers.set(result.session.id, "");
    ready.value = true;
  }

  async function write(data: string) {
    if (!window.zen?.terminal || !sessionId.value) {
      return;
    }
    await window.zen.terminal.write(sessionId.value, data);
  }

  async function resize(cols: number, rows: number) {
    if (!window.zen?.terminal || !sessionId.value) {
      return;
    }
    await window.zen.terminal.resize(sessionId.value, cols, rows);
  }

  async function restart(cwd?: string) {
    if (sessionId.value && window.zen?.terminal) {
      await window.zen.terminal.kill(sessionId.value);
    }
    session.value = null;
    ready.value = false;
    await start(cwd);
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
    session,
    sessionId,
    shellLabel,
    buffer,
    error,
    ready,
    bindEvents,
    loadShell,
    start,
    write,
    resize,
    restart,
    openExternal,
  };
});
