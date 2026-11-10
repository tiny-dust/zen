import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as unknown[],
  starts: [] as unknown[][],
  history: {
    messages: [
      { role: "user", content: "上一轮" },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "思考", providerOptions: { anthropic: { signature: "signed" } } }],
      },
    ],
    instructions: "[上下文已压缩] 上轮摘要",
  } as unknown,
  mcpTools: [] as unknown[],
}));

vi.mock("@zen/agent-core", () => ({
  AgentSession: class {
    constructor(config: unknown) {
      state.configs.push(config);
    }
    start(...args: unknown[]) {
      state.starts.push(args);
      return Promise.resolve();
    }
    cancel() {
      return Promise.resolve();
    }
  },
  runMockAgent: vi.fn(),
}));
vi.mock("@zen/skills", () => ({ listSkills: vi.fn(async () => []) }));
vi.mock("./agent-images", () => ({
  loadImageAttachments: vi.fn(),
  isImagePath: vi.fn(() => false),
  withImageAnalysisText: vi.fn(),
}));
vi.mock("./agent-services", () => ({ getAgentServicesRegistry: vi.fn(() => null) }));
vi.mock("./browser/service", () => ({ getBrowserRegistry: vi.fn(() => ({ forScope: () => ({}) })) }));
vi.mock("./lark/ipc", () => ({ notifyLarkEvent: vi.fn() }));
vi.mock("./memory", () => ({
  appendMemoryNote: vi.fn(),
  readMemorySnapshot: vi.fn(async () => null),
  renderMemoryContext: vi.fn(),
}));
vi.mock("./mcp-ipc", () => ({ enabledMcpTools: vi.fn(async () => state.mcpTools) }));
vi.mock("./model-capabilities", () => ({ inspectModelCapabilities: vi.fn(() => ({})) }));
vi.mock("./model-db", () => ({
  getSelection: vi.fn(async () => ({ providerId: "p-anthropic", modelId: "claude-sonnet-4-6" })),
  listProviders: vi.fn(async () => [
    { id: "p-anthropic", protocol: "anthropic-messages", baseUrl: "https://example.invalid", models: [] },
    { id: "p-openai", protocol: "openai-responses", baseUrl: "https://example.invalid", models: [] },
  ]),
  loadProviderApiKey: vi.fn(async () => "test-key"),
  isChatGptAuthProvider: vi.fn(() => false),
}));
vi.mock("./prompt-presets", () => ({ resolvePromptText: vi.fn(() => "system") }));
vi.mock("./sandbox", () => ({ resolveWorkspaceDir: vi.fn(async () => ({ dir: "/tmp/test-workspace" })) }));
vi.mock("./session-worktree", () => ({ resolveSessionWorktreeRoot: vi.fn(async () => null) }));
vi.mock("./session-checkpoints", () => ({ beginTurnCheckpoint: vi.fn(async () => 1) }));
vi.mock("./websearch-auth-store", () => ({ getWebSearchApiKeys: vi.fn(async () => ({})) }));
vi.mock("./zen-dir", () => ({
  loadAgentSettings: vi.fn(async () => ({
    sandboxMode: "off", permissionMode: "auto", skillExtraPaths: [], approvalRules: [],
  })),
}));
vi.mock("./workspace-db", () => ({
  appendMessage: vi.fn(),
  appendSessionModelHistory: vi.fn(),
  ensureSessionTitle: vi.fn(),
  getSession: vi.fn(() => ({ session: { id: "s1", mode: "interactive" }, messages: [], taskLists: [] })),
  getWorkspace: vi.fn(() => ({ path: "/tmp/test-workspace" })),
  loadSessionModelHistory: vi.fn(() => state.history),
  recordGoalUsage: vi.fn(),
  rewriteSessionModelHistory: vi.fn(),
  saveTaskList: vi.fn(),
  setSessionMode: vi.fn(),
}));

import { runAgentRequest } from "./agent-runner";
import { loadSessionModelHistory } from "./workspace-db";

describe("runAgentRequest 跨模型历史回放", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.configs.length = 0;
    state.starts.length = 0;
    state.mcpTools = [{ name: "oldTool" }];
    state.history = {
      messages: [
        { role: "user", content: "上一轮" },
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "思考", providerOptions: { anthropic: { signature: "signed" } } }],
        },
      ],
      instructions: "[上下文已压缩] 上轮摘要",
    };
  });

  it("每轮读取当前 MCP 工具和所选模型，但原样传递已压缩历史与 Anthropic thinking 元数据", async () => {
    const sessions = new Map();
    const first = await runAgentRequest(
      { sessionId: "s1", workspaceId: "w1", workspaceRoot: "", userMessage: "继续", history: [] },
      { sessions },
    );
    expect(first.ok).toBe(true);

    state.mcpTools = [{ name: "newTool" }];
    const second = await runAgentRequest(
      {
        sessionId: "s1", workspaceId: "w1", workspaceRoot: "", userMessage: "换模型继续",
        history: [{ role: "user", content: "展示层兜底历史" }],
        providerId: "p-openai", model: "gpt-6",
      },
      { sessions },
    );
    expect(second.ok).toBe(true);
    expect(loadSessionModelHistory).toHaveBeenCalledTimes(2);
    expect(state.configs).toEqual([
      expect.objectContaining({ model: "claude-sonnet-4-6", protocol: "anthropic-messages", mcpTools: [{ name: "oldTool" }] }),
      expect.objectContaining({ model: "gpt-6", protocol: "openai-responses", mcpTools: [{ name: "newTool" }] }),
    ]);
    expect(state.starts[1]).toEqual([
      "换模型继续",
      [{ role: "user", content: "展示层兜底历史" }],
      undefined,
      state.history,
    ]);
    expect(state.history).toEqual(expect.objectContaining({ instructions: "[上下文已压缩] 上轮摘要" }));
  });

  it("持久化历史读取失败时仍传入展示层历史兜底", async () => {
    vi.mocked(loadSessionModelHistory).mockImplementationOnce(() => {
      throw new Error("history unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const history = [{ role: "user" as const, content: "旧问题" }];
      const result = await runAgentRequest(
        { sessionId: "s1", workspaceId: "w1", workspaceRoot: "", userMessage: "继续", history },
        { sessions: new Map() },
      );
      expect(result.ok).toBe(true);
      expect(state.starts[0]).toEqual(["继续", history, undefined, undefined]);
      expect(warn).toHaveBeenCalledWith(
        "[model-history] 载入失败，回落 ChatTurn 历史:",
        expect.objectContaining({ message: "history unavailable" }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
