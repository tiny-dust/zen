import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentServiceInfo } from "@zen/shared";

import { i18n } from "@/locales";

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

  it("进程指标：采样不到时显示不可用，不填 0", () => {
    const store = useAgentServicesStore();
    store.items = [service("a")];
    expect(store.statLabel(service("a"))).toBe(i18n.global.t("app.services.statsUnavailable"));
  });

  it("进程指标：整组 pid 全部采样到才求和，缺一个都标不可用", () => {
    const store = useAgentServicesStore();
    store.stats = {
      "101": { pid: 101, cpuPercent: 1.5, rssBytes: 10 * 1024 * 1024 },
      "102": { pid: 102, cpuPercent: 2, rssBytes: 5 * 1024 * 1024 },
    };
    const t = i18n.global.t;
    expect(store.statLabel(service("a"))).toBe(
      `${t("app.services.cpuPercent", { value: "3.5" })} · ${t("app.services.memoryUsage", { value: "15.0 MB" })}`,
    );

    store.stats = {
      "101": { pid: 101, cpuPercent: 1.5, rssBytes: 10 * 1024 * 1024 },
      "102": { pid: 102, cpuPercent: 2, rssBytes: null },
    };
    expect(store.statLabel(service("a"))).toBe(t("app.services.cpuPercent", { value: "3.5" }));
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
