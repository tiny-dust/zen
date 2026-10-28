// 复现/回归：runAgentRequest 前置（查会话/落库/清旧 run）抛错只能走 {ok:false}，
// 不能让 agent:run IPC reject——渲染层 send() 会因此卡死运行态（发送无反应 + 侧栏一直转圈）。
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionRecord: { session: { id: "s1" }, messages: [], taskLists: [] } as unknown,
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
  appendSessionModelHistory: vi.fn(),
  createSession: vi.fn(),
  createWorkspace: vi.fn(),
  ensureSessionTitle: vi.fn(),
  getSession: vi.fn(() => state.sessionRecord),
  getWorkspace: vi.fn(() => null),
  listWorkspaceGroups: vi.fn(() => []),
  loadSessionModelHistory: vi.fn(() => null),
  rewriteSessionModelHistory: vi.fn(),
  saveTaskList: vi.fn(),
  setSessionMode: vi.fn(),
}));

import { runAgentRequest } from "./agent-runner";
import { appendMessage, setSessionMode } from "./workspace-db";

describe("display 落库优先级", () => {
  it("带 display 的请求：落库 content 用 display.content，meta 合并 display.meta", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };

    const result = await runAgentRequest(
      {
        sessionId: "s1",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "点击 [页面元素] selector=`#login` …",
        history: [],
        display: {
          content: "点击 $el:登录 按钮",
          meta: {
            elementMarks: [{ token: "$el:登录", ref: { selector: "#login", tag: "button" } }],
          },
        },
      },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(appendMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        role: "user",
        // 展示版正文（原始 token）落库，气泡 tag 依赖它恢复
        content: "点击 $el:登录 按钮",
        meta: expect.objectContaining({
          elementMarks: [{ token: "$el:登录", ref: { selector: "#login", tag: "button" } }],
        }),
      }),
    );
  });

  it("无 display 的请求：沿用 userMessage，仅 attachments 进 meta（与旧行为一致）", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };

    await runAgentRequest(
      {
        sessionId: "s1",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "你好",
        history: [],
        attachments: [{ name: "a.png", path: "/tmp/a.png" }],
      },
      { sessions: new Map() },
    );

    expect(appendMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        role: "user",
        content: "你好",
        meta: { attachments: [{ name: "a.png", path: "/tmp/a.png" }] },
      }),
    );

    // 空附件 + 无 display：meta 不写（保持旧的 undefined 语义）
    await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "你好", history: [] },
      { sessions: new Map() },
    );
    expect(vi.mocked(appendMessage).mock.lastCall?.[1]?.meta).toBeUndefined();
  });
});

describe("runAgentRequest 前置失败契约", () => {
  it("落库抛错返回 {ok:false} 而不是 reject", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };
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
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };
  });
});

describe("计划模式批准回落 interactive", () => {
  it("plan 会话收到 approvePlan：先落库切回 interactive，run 正常继续", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [], taskLists: [] };

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
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [], taskLists: [] };

    const result = await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "批准执行，但先改一下登录页", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(setSessionMode).toHaveBeenCalledWith("s1", "interactive");
  });

  it("plan 会话的计划反馈消息：保持 plan，不落库切换", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "plan" }, messages: [], taskLists: [] };

    const result = await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "第二步拆细一点", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(setSessionMode).not.toHaveBeenCalledWith("s1", "interactive");
  });

  it("非 plan 会话即使带 approvePlan 也不落库切换", async () => {
    state.sessionRecord = { session: { id: "s1", mode: "autopilot" }, messages: [], taskLists: [] };

    await runAgentRequest(
      { sessionId: "s1", workspaceId: "common", workspaceRoot: "", userMessage: "批准执行", history: [], approvePlan: true },
      { sessions: new Map() },
    );

    expect(setSessionMode).not.toHaveBeenCalled();
  });
});
