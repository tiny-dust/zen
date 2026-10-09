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
}));

import { runAgentRequest } from "./agent-runner";

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
