// 会话面板分桶行为：agent-processes / agents / session-info 的
// 「切走再切回恢复」「后台会话事件不劫持当前视图」两条主链路。
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { AgentNodeState } from "@zen/shared";

import { useAgentProcessesStore } from "@/stores/agent-processes";
import { useAgentsStore } from "@/stores/agents";
import { useSessionInfoStore } from "@/stores/session-info";

beforeEach(() => {
  setActivePinia(createPinia());
});

function nodeOf(id: string, overrides: Partial<AgentNodeState> = {}): AgentNodeState {
  return {
    id,
    sessionId: "s1",
    parentId: null,
    name: id,
    task: "任务",
    status: "running",
    dependsOn: [],
    attempts: 1,
    maxAttempts: 1,
    log: [],
    ...overrides,
  };
}

describe("agent-processes 分桶", () => {
  it("切走再切回恢复进程清单；后台会话 runTerminal 事件落桶不劫持当前视图", () => {
    const store = useAgentProcessesStore();
    store.ensureSession("s1");
    store.noteToolStart("s1", "tc1", "runTerminal", { command: "npm run dev" });
    expect(store.items).toHaveLength(1);

    // 切到 s2：视图清空，s1 入桶
    store.ensureSession("s2");
    expect(store.items).toHaveLength(0);

    // 后台会话 s1 的进程事件：写入 s1 的桶，不动当前视图
    store.noteToolStart("s1", "tc2", "runTerminal", { command: "vite" });
    store.noteToolEnd("s1", "tc1", "runTerminal", {
      ok: true,
      summary: "完成",
      output: { exitCode: 0, output: "done" },
    });
    expect(store.items).toHaveLength(0);
    expect(store.ownerSessionId).toBe("s2");

    // 切回 s1：恢复桶内容，含后台期间的事件
    store.ensureSession("s1");
    expect(store.items.map((item) => item.id)).toEqual(["tc1", "tc2"]);
    expect(store.items[0]?.status).toBe("ok");
    expect(store.items[0]?.output).toBe("done");
    expect(store.items[1]?.command).toBe("vite");
  });

  it("tool_progress 输出尾部写进后台桶，切回可见", () => {
    const store = useAgentProcessesStore();
    store.ensureSession("s1");
    store.noteToolStart("s1", "tc1", "runTerminal", { command: "npm run dev" });
    store.ensureSession("s2");
    store.noteToolProgress("s1", {
      toolCallId: "tc1",
      toolName: "runTerminal",
      message: "输出",
      outputTail: "server ready",
    });
    expect(store.items).toHaveLength(0);
    store.ensureSession("s1");
    expect(store.items[0]?.output).toBe("server ready");
  });

  it("一次性命令不进面板", () => {
    const store = useAgentProcessesStore();
    store.ensureSession("s1");
    store.noteToolStart("s1", "tc1", "runTerminal", { command: "ls -la" });
    store.noteToolStart("s1", "tc2", "readFile", { path: "a.ts" });
    expect(store.items).toHaveLength(0);
  });
});

describe("agents 分桶", () => {
  it("applySnapshot 后台会话落桶不劫持；切回恢复选中态", () => {
    const store = useAgentsStore();
    store.ensureSession("s1");
    store.applySnapshot({
      sessionId: "s1",
      agents: [nodeOf("a1"), nodeOf("a2")],
      concurrency: { limit: 2, running: 1 },
    });
    store.select("a2");
    expect(store.selectedId).toBe("a2");

    store.ensureSession("s2");
    expect(store.nodes).toHaveLength(0);
    expect(store.sessionId).toBe("s2");

    // 后台会话 s1 的 agent_tree：落桶，当前视图仍是 s2 的空态
    store.applySnapshot({
      sessionId: "s1",
      agents: [nodeOf("a1", { status: "done" }), nodeOf("a2"), nodeOf("a3")],
      concurrency: { limit: 2, running: 2 },
    });
    expect(store.nodes).toHaveLength(0);

    store.ensureSession("s1");
    expect(store.nodes.map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(store.nodes[0]?.status).toBe("done");
    expect(store.selectedId).toBe("a2");
    expect(store.running).toBe(2);
  });

  it("applyStatus 后台会话 upsert 落桶", () => {
    const store = useAgentsStore();
    store.ensureSession("s1");
    store.applySnapshot({
      sessionId: "s1",
      agents: [nodeOf("a1")],
      concurrency: { limit: 2, running: 1 },
    });
    store.ensureSession("s2");
    store.applyStatus({
      sessionId: "s1",
      agent: nodeOf("a1", { status: "error", error: "失败" }),
      concurrency: { limit: 2, running: 0 },
    });
    expect(store.nodes).toHaveLength(0);
    store.ensureSession("s1");
    expect(store.nodes[0]?.status).toBe("error");
    expect(store.running).toBe(0);
  });
});

describe("session-info 分桶", () => {
  it("applyTasksUpdated / addReference 后台会话落桶；切回恢复", () => {
    const store = useSessionInfoStore();
    store.ensureSession("s1");
    store.applyTasksUpdated("s1", 1, [
      { id: "t1", label: "步骤一", done: true },
      { id: "t2", label: "步骤二", done: false },
    ]);
    store.addReference("s1", { id: "", title: "doc", url: "https://doc", source: "user" });

    store.ensureSession("s2");
    expect(store.versions).toHaveLength(0);
    expect(store.references).toHaveLength(0);

    // 后台会话 s1 的任务更新与参考：落桶
    store.applyTasksUpdated("s1", 2, [
      { id: "t1", label: "步骤一", done: true },
      { id: "t2", label: "步骤二", done: true },
    ]);
    store.addReference("s1", { id: "", title: "ref", url: "https://ref", source: "project" });
    expect(store.versions).toHaveLength(0);
    expect(store.references).toHaveLength(0);

    store.ensureSession("s1");
    expect(store.activeTasks.map((item) => item.done)).toEqual([true, true]);
    expect(store.references.map((item) => item.url)).toEqual(["https://doc", "https://ref"]);
  });

  it("子 Agent 侧信道（带 agentName）在后台桶按 upsert 合并", () => {
    const store = useSessionInfoStore();
    store.ensureSession("s1");
    store.ensureSession("s2");
    store.applyTasksUpdated("s1", 1, [{ id: "t1", label: "主任务", done: false }]);
    store.applyTasksUpdated(
      "s1",
      2,
      [{ id: "sub1", label: "子任务", done: true }],
      "子 Agent",
    );
    expect(store.activeTasks).toHaveLength(0);
    store.ensureSession("s1");
    // 主清单 v1 + 子 Agent upsert 合并出的条目（无激活版本时新建 v1 容纳）
    const labels = store.activeTasks.map((item) => item.label);
    expect(labels).toContain("主任务");
    expect(labels).toContain("子任务");
    expect(store.activeTasks.find((item) => item.label === "子任务")?.agentName).toBe("子 Agent");
  });
});
