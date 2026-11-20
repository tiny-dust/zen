// 复现/回归：runAgentRequest 前置（查会话/落库/清旧 run）抛错只能走 {ok:false}，
// 不能让 agent:run IPC reject——渲染层 send() 会因此卡死运行态（发送无反应 + 侧栏一直转圈）。
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionRecord: { session: { id: "s1" }, messages: [], taskLists: [] } as unknown,
  appendError: null as Error | null,
  /** 假 AgentSession 跑过的模型，按发生顺序记录（验证两段各用一个模型） */
  ranModels: [] as string[],
}));

// 假 AgentSession：构造时拿 emit，start 时直接推一段正文 + done，覆盖两阶段编排
vi.mock("@zen/agent-core", () => ({
  AgentSession: class {
    private readonly options: {
      sessionId: string;
      model: string;
      emit?: (event: unknown) => void;
    };
    constructor(options: { sessionId: string; model: string; emit?: (event: unknown) => void }) {
      this.options = options;
    }
    getRunState() {
      return { runActive: false, waitingApproval: false, waitingAskCount: 0, inserting: false };
    }
    async cancel() {}
    async start() {
      state.ranModels.push(this.options.model);
      this.options.emit?.({ type: "delta", sessionId: this.options.sessionId, text: "步骤" });
      this.options.emit?.({ type: "done", sessionId: this.options.sessionId, reason: "stop" });
    }
  },
  runMockAgent: vi.fn(),
}));
vi.mock("./session-checkpoints", () => ({
  backupAfterWrite: vi.fn(),
  backupWorkspaceFile: vi.fn(),
  beginTurnCheckpoint: vi.fn(async () => 1),
}));
vi.mock("./user-ipc", () => ({ loadAppSettings: vi.fn(async () => ({})) }));
vi.mock("./websearch-auth-store", () => ({ getWebSearchApiKeys: vi.fn(async () => ({})) }));
vi.mock("./agent-images", () => ({
  loadImageAttachments: vi.fn(),
  isImagePath: vi.fn(() => false),
  withImageAnalysisText: vi.fn(),
}));
vi.mock("./agent-services", () => ({ getAgentServicesRegistry: vi.fn(() => null) }));
vi.mock("./browser/service", () => ({
  getBrowserService: vi.fn(() => null),
  getBrowserRegistry: vi.fn(() => ({ forScope: vi.fn(() => ({})) })),
}));
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
  isChatGptAuthProvider: vi.fn(() => false),
}));
vi.mock("./prompt-presets", () => ({ resolvePromptText: vi.fn(() => "") }));
vi.mock("./sandbox", () => ({ resolveWorkspaceDir: vi.fn() }));
vi.mock("./zen-dir", () => ({
  loadAgentSettings: vi.fn(async () => ({
    sandboxMode: "off",
    permissionMode: "auto",
    approvalRules: [],
    skillExtraPaths: [],
  })),
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
  recordGoalUsage: vi.fn(),
  rewriteSessionModelHistory: vi.fn(),
  saveTaskList: vi.fn(),
  setSessionMode: vi.fn(),
}));

import { runAgentRequest } from "./agent-runner";
import { runMockAgent } from "@zen/agent-core";
import { listProviders } from "./model-db";
import { appendMessage, recordGoalUsage, setSessionMode } from "./workspace-db";

import type { AgentStreamEvent, ProviderSummary } from "@zen/shared";

/** 测试用供应商：一个供应商一个模型，够 resolvePhaseModel 选模 */
function providerSummary(providerId: string, modelId: string): ProviderSummary {
  return {
    id: providerId,
    name: providerId,
    protocol: "openai-chat",
    baseUrl: "",
    enabled: true,
    hasApiKey: true,
    apiKeyMask: "",
    models: [{ id: modelId, name: modelId, enabled: true }],
    createdAt: 1,
    updatedAt: 1,
  };
}

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

  it("display.id 优先作为落库消息 id：与本地乐观气泡同 id，切会话合并不会出现两条", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };

    await runAgentRequest(
      {
        sessionId: "s1",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "你好",
        history: [],
        display: { id: "local-bubble-id", content: "你好" },
      },
      { sessions: new Map() },
    );

    expect(appendMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ id: "local-bubble-id", role: "user", content: "你好" }),
    );
  });

  it("display.id 非法（空串）时回落自生成 id", async () => {
    state.sessionRecord = { session: { id: "s1" }, messages: [], taskLists: [] };

    await runAgentRequest(
      {
        sessionId: "s1",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "你好",
        history: [],
        display: { id: "   ", content: "你好" },
      },
      { sessions: new Map() },
    );

    const saved = vi.mocked(appendMessage).mock.lastCall?.[1];
    expect(typeof saved?.id).toBe("string");
    expect(saved?.id.trim()).not.toBe("");
    expect(saved?.id).not.toBe("   ");
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

describe("目标用量事件", () => {
  it("每次 usage 事件按本轮目标和会话记录", async () => {
    state.sessionRecord = {
      session: { id: "goal-session", mode: "interactive", goal: { text: "完成登录", status: "active", tokenBudget: 100 } },
      messages: [], taskLists: [],
    };
    vi.mocked(runMockAgent).mockImplementationOnce(async (sessionId, _message, _signal, emit) => {
      emit({ type: "usage", sessionId, inputTokens: 10, outputTokens: 3 });
      emit({ type: "usage", sessionId, inputTokens: 7, outputTokens: 2 });
      emit({ type: "done", sessionId, reason: "stop" });
    });

    const result = await runAgentRequest(
      { sessionId: "goal-session", workspaceId: "common", workspaceRoot: "", userMessage: "继续", history: [] },
      { sessions: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(recordGoalUsage).toHaveBeenNthCalledWith(1, "goal-session", "完成登录", 10, 3);
    expect(recordGoalUsage).toHaveBeenNthCalledWith(2, "goal-session", "完成登录", 7, 2);
  });

  it("本轮开始时目标暂停则不累计用量", async () => {
    vi.mocked(recordGoalUsage).mockClear();
    state.sessionRecord = {
      session: { id: "paused-session", mode: "interactive", goal: { text: "完成登录", status: "paused", tokenBudget: 100 } },
      messages: [], taskLists: [],
    };
    vi.mocked(runMockAgent).mockImplementationOnce(async (sessionId, _message, _signal, emit) => {
      emit({ type: "usage", sessionId, inputTokens: 10, outputTokens: 3 });
      emit({ type: "done", sessionId, reason: "stop" });
    });

    await runAgentRequest(
      { sessionId: "paused-session", workspaceId: "common", workspaceRoot: "", userMessage: "继续", history: [] },
      { sessions: new Map() },
    );

    expect(recordGoalUsage).not.toHaveBeenCalled();
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

describe("自动两阶段（P/A 双模型）", () => {
  it("plan 段 → act 段复用同一条请求：用户消息只落库一次", async () => {
    state.sessionRecord = {
      session: {
        id: "pair-session",
        mode: "interactive",
        pairMode: true,
        planModelProviderId: "p-plan",
        planModelId: "m-plan",
      },
      messages: [],
      taskLists: [],
    };
    vi.mocked(listProviders).mockResolvedValue([
      providerSummary("p-plan", "m-plan"),
      providerSummary("p-act", "m-act"),
    ]);
    state.ranModels = [];
    vi.mocked(appendMessage).mockClear();
    const events: AgentStreamEvent[] = [];

    const result = await runAgentRequest(
      {
        sessionId: "pair-session",
        workspaceId: "common",
        workspaceRoot: "",
        userMessage: "做个功能",
        history: [],
        providerId: "p-act",
        model: "m-act",
      },
      { sessions: new Map(), send: (event) => events.push(event) },
    );

    expect(result.ok).toBe(true);
    // 两段都跑了：计划段 + 执行段各一次 phase_start，且各用自己的模型
    expect(events.filter((event) => event.type === "phase_start")).toHaveLength(2);
    expect(state.ranModels).toEqual(["m-plan", "m-act"]);
    // 内层段不再重复落库，否则一次发送会存下多条同样的用户消息
    const userSaves = vi
      .mocked(appendMessage)
      .mock.calls.filter(([, message]) => message.role === "user");
    expect(userSaves).toHaveLength(1);
  });
});
