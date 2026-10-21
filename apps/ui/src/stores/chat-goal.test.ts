// 会话目标（Goals 目标模式）渲染层回归：
// - setSessionGoal：已持久化会话即写 IPC；未持久化会话先记内存、首发补建时落库；
// - doLoadSession：session.open 返回的 goal 恢复进 store；newTask 复位为空；
// - goalBudgetLabel：会话累计消耗 vs 预算（12.3K/50K）；
// - continueGoal：目标 active 时以含目标文本的消息续跑；paused / 运行中不发送。
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";

const agentRun = vi.fn();

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: agentRun,
      insert: vi.fn(),
      steer: vi.fn(),
    },
    session: {
      create: vi.fn(async (_workspaceId: string | null, id?: string) => ({
        id: id ?? "created",
        title: "新会话",
        workspaceId: null,
        draft: "",
        pinned: false,
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })),
      open: vi.fn(),
      setDraft: vi.fn(),
      rename: vi.fn(),
      setWorkspace: vi.fn(),
      setMode: vi.fn(),
      setGoal: vi.fn(),
      autoTitle: vi.fn().mockResolvedValue(""),
    },
    workspace: {
      list: vi.fn().mockResolvedValue([
        {
          id: "common",
          name: "公共区",
          kind: "common",
          path: null,
          archived: false,
          pinned: false,
          sessions: [],
        },
      ]),
    },
    git: {
      info: vi.fn().mockResolvedValue({ repo: "", branch: "" }),
      status: vi.fn().mockResolvedValue(null),
    },
  });
}

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  stubZen();
  const models = useModelsStore();
  models.selection = { providerId: "p1", modelId: "m1" };
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("goal 持久化与恢复", () => {
  it("已持久化会话：setSessionGoal 立即写 session.setGoal，null 清除", async () => {
    const chat = useChatStore();
    await chat.newTask();

    await chat.setSessionGoal({ text: "完成登录模块", status: "active", tokenBudget: 50000 });
    const zen = window.zen;
    expect(zen?.session.setGoal).toHaveBeenCalledWith(chat.sessionId, {
      text: "完成登录模块",
      status: "active",
      tokenBudget: 50000,
    });

    await chat.setSessionGoal(null);
    expect(zen?.session.setGoal).toHaveBeenLastCalledWith(chat.sessionId, null);
    expect(chat.sessionGoal).toBeNull();
  });

  it("未持久化会话：setSessionGoal 先记内存，首发 send 补建会话时落库", async () => {
    const chat = useChatStore();
    const zen = window.zen;

    await chat.setSessionGoal({ text: "未落库目标", status: "active", tokenBudget: null });
    // 未补建前不写 IPC
    expect(zen?.session.setGoal).not.toHaveBeenCalled();
    expect(chat.sessionGoal?.text).toBe("未落库目标");

    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "正常发送一条";
    await chat.send();
    expect(zen?.session.setGoal).toHaveBeenCalledWith(chat.sessionId, {
      text: "未落库目标",
      status: "active",
      tokenBudget: null,
    });
  });

  it("loadSession 恢复 session.open 返回的 goal；newTask 复位为空", async () => {
    const chat = useChatStore();
    const zen = window.zen;

    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: "goal-session",
        title: "T",
        workspaceId: null,
        draft: "",
        mode: "interactive",
        goal: { text: "恢复的目标", status: "blocked", tokenBudget: 1234 },
      },
      messages: [],
    });
    await chat.loadSession({
      id: "goal-session",
      title: "T",
      workspaceId: null,
      draft: "",
      pinned: false,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(chat.sessionGoal).toEqual({
      text: "恢复的目标",
      status: "blocked",
      tokenBudget: 1234,
    });

    await chat.newTask();
    expect(chat.sessionGoal).toBeNull();
  });

  it("updateGoalStatus 只切状态，保留文本与预算", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "目标", status: "active", tokenBudget: 1000 });

    await chat.updateGoalStatus("paused");
    expect(chat.sessionGoal).toEqual({ text: "目标", status: "paused", tokenBudget: 1000 });

    await chat.updateGoalStatus("active");
    expect(chat.sessionGoal?.status).toBe("active");
  });
});

describe("goalBudgetLabel 预算消耗", () => {
  it("会话累计消耗 vs 预算（12.3K/50K）；无预算/无目标为 null", async () => {
    const chat = useChatStore();
    expect(chat.goalBudgetLabel).toBeNull();

    await chat.setSessionGoal({ text: "目标", status: "active", tokenBudget: null });
    expect(chat.goalBudgetLabel).toBeNull();

    await chat.setSessionGoal({ text: "目标", status: "active", tokenBudget: 50000 });
    chat.sessionTotalTokens = 12300;
    expect(chat.goalBudgetLabel).toBe("12.3K/50K");
  });
});

describe("continueGoal 一键续跑", () => {
  it("目标 active：以包含目标文本的消息发起 run", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "做完收尾", status: "active", tokenBudget: null });

    agentRun.mockResolvedValueOnce({ ok: true });
    await chat.continueGoal();

    expect(agentRun).toHaveBeenCalledTimes(1);
    const request = agentRun.mock.calls[0]?.[0] as { userMessage?: string };
    expect(request.userMessage).toContain("做完收尾");
    expect(request.userMessage).toContain("继续推进目标");
    // 本地落一条用户消息
    expect(chat.messages.some((message) => message.role === "user" && message.content.includes("做完收尾"))).toBe(true);
  });

  it("目标 paused / 无目标 / 运行中：不发送", async () => {
    const chat = useChatStore();

    await chat.continueGoal();
    expect(agentRun).not.toHaveBeenCalled();

    await chat.newTask();
    await chat.setSessionGoal({ text: "目标", status: "paused", tokenBudget: null });
    await chat.continueGoal();
    expect(agentRun).not.toHaveBeenCalled();

    await chat.updateGoalStatus("active");
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "先跑一个任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);
    await chat.continueGoal();
    // 运行中不重复发起 run（只有首发的这一次）
    expect(agentRun).toHaveBeenCalledTimes(1);
  });
});
