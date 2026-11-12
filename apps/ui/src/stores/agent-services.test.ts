import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentServiceInfo } from "@zen/shared";

import { useAgentProcessesStore } from "./agent-processes";
import { useAgentServicesStore } from "./agent-services";
import { useTerminalStore } from "./terminal";

function service(id: string): AgentServiceInfo {
  return {
    id,
    sessionId: "session-1",
    label: "npm run dev",
    command: "npm run dev",
    cwd: "/tmp/project",
    startedAt: Date.now(),
    pids: [101, 102],
  };
}

describe("useAgentServicesStore 详情展开", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggle 展开与收起", () => {
    const store = useAgentServicesStore();
    store.items = [service("a")];

    store.toggle("a");
    expect(store.expandedId).toBe("a");
    store.toggle("a");
    expect(store.expandedId).toBe("");
  });

  it("展开的服务从清单移除后自动收起（refresh 推送刷新）", async () => {
    vi.stubGlobal("zen", undefined);
    const store = useAgentServicesStore();
    store.items = [service("a"), service("b")];
    store.toggle("a");

    vi.stubGlobal("zen", {
      services: {
        onChange: () => () => undefined,
        list: async () => [service("b")],
      },
    });
    await store.refresh();

    expect(store.items.map((item) => item.id)).toEqual(["b"]);
    expect(store.expandedId).toBe("");
  });

  it("kill 无 IPC 桥时返回错误，不影响展开态", async () => {
    vi.stubGlobal("zen", undefined);
    const store = useAgentServicesStore();
    store.items = [service("a")];
    store.toggle("a");

    const result = await store.kill("a");
    expect(result.ok).toBe(false);
    expect(store.items.map((item) => item.id)).toEqual(["a"]);
    expect(store.expandedId).toBe("a");
  });

  it("按父会话汇总运行中的 Agent 命令、后台服务和活动 PTY", () => {
    const store = useAgentServicesStore();
    const processes = useAgentProcessesStore();
    const terminal = useTerminalStore();
    processes.noteToolStart("session-1::worker", "tool-1", "runTerminal", { command: "pnpm dev" });
    store.items = [service("service-1")];
    terminal.activeActivities = [
      { terminalId: "pty-1", ownerSessionId: "session-1", active: true },
      { terminalId: "pty-2", ownerSessionId: "session-2", active: true },
    ];
    expect(store.activeSessionCounts).toEqual({ "session-1": 3, "session-2": 1 });
    processes.noteToolEnd("session-1::worker", "tool-1", "runTerminal", { ok: true, summary: "done" });
    store.items = [];
    terminal.activeActivities = [];
    expect(store.activeSessionCounts).toEqual({});
  });
});
