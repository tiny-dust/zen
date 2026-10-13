// 复现/回归：runAgentRequest 前置（查会话/落库/清旧 run）抛错只能走 {ok:false}，
// 不能让 agent:run IPC reject——渲染层 send() 会因此卡死运行态（发送无反应 + 侧栏一直转圈）。
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionRecord: { session: { id: "s1" }, messages: [] } as unknown,
  appendError: null as Error | null,
}));

vi.mock("@zen/agent-core", () => ({
  AgentSession: class {},
  runMockAgent: vi.fn(),
}));
vi.mock("./agent-images", () => ({
  loadImageAttachments: vi.fn(),
  isImagePath: vi.fn(() => false),
  withImageAnalysisText: vi.fn(),
}));
vi.mock("./agent-services", () => ({ getAgentServicesRegistry: vi.fn(() => null) }));
vi.mock("./browser/service", () => ({ getBrowserService: vi.fn(() => null) }));
vi.mock("./lark/ipc", () => ({ notifyLarkEvent: vi.fn() }));
vi.mock("./memory", () => ({
  appendMemoryNote: vi.fn(),
  readMemorySnapshot: vi.fn(async () => null),
  renderMemoryContext: vi.fn(),
}));
vi.mock("./mcp-ipc", () => ({ enabledMcpTools: vi.fn(async () => []) }));
vi.mock("./model-capabilities", () => ({ inspectModelCapabilities: vi.fn(() => ({})) }));
vi.mock("./model-db", () => ({
  getSelection: vi.fn(async () => ({ providerId: null, modelId: null })),
  listProviders: vi.fn(async () => []),
  loadProviderApiKey: vi.fn(async () => ""),
}));
vi.mock("./prompt-presets", () => ({ resolvePromptText: vi.fn(() => "") }));
vi.mock("./sandbox", () => ({ resolveWorkspaceDir: vi.fn() }));
vi.mock("./zen-dir", () => ({
  loadAgentSettings: vi.fn(async () => ({ sandboxMode: "off", permissionMode: "auto" })),
  sessionCacheDir: vi.fn(() => "/tmp/zen-test-session"),
}));
vi.mock("./workspace-db", () => ({
  appendMessage: vi.fn(() => {
    if (state.appendError) {
      throw state.appendError;
    }
  }),
  createSession: vi.fn(),
  createWorkspace: vi.fn(),
  ensureSessionTitle: vi.fn(),
  getSession: vi.fn(() => state.sessionRecord),
  getWorkspace: vi.fn(() => null),
  listWorkspaceGroups: vi.fn(() => []),
  saveTaskList: vi.fn(),
  setSessionMode: vi.fn(),
}));

import { runAgentRequest } from "./agent-runner";
import { setSessionMode } from "./workspace-db";

describe("runAgentRequest 前置失败契约", () => {
  it("落库抛错返回 {ok:false} 而不是 reject", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [] };
    state.appendError = new Error("database is locked");

    const result = await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "你好", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("database is locked");
    state.appendError = null;
  });

  it("会话不存在返回 session not found", async () => {
    state.sessionRecord = null;

    const result = await runAgentRequest(
      { sessionId: "missing", workspaceId: "common", workspaceRoot: "", userMessage: "你好", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("session not found");
    state.sessionRecord = { session: { id: "s1" }, messages: [] };
  });
});

describe("计划模式批准回落 interactive", () => {
  it("plan 会话收到 approvePlan：先落库切回 interactive，run 正常继续", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [] };

    const result = await runAgentRequest(
      {
        sessionId: "s1",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "批准执行",
        history: [],
        approvePlan: true,
      },
      { sessions: new Map() },
    );

    // 无供应商配置 → mock agent 兜底跑通；批准动作的关键契约是落库切回 interactive
    expect(result.ok).toBe(true);
    expect(setSessionMode).toHaveBeenCalledWith("s1", "interactive");
  });

  it("手打「批准执行」开头的消息同样视为批准（approvePlan 省略）", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [] };

    const result = await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "批准执行，但先改一下登录页", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(setSessionMode).toHaveBeenCalledWith("s1", "interactive");
  });

  it("plan 会话的计划反馈消息：保持 plan，不落库切换", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [] };

    const result = await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "第二步拆细一点", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(setSessionMode).not.toHaveBeenCalledWith("s1", "interactive");
  });

  it("非 plan 会话即使带 approvePlan 也不落库切换", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "autopilot" }, messages: [] };

    await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "批准执行", history: [], approvePlan: true },
      { sessions: new Map() },
    );

    expect(setSessionMode).not.toHaveBeenCalled();
  });
});
