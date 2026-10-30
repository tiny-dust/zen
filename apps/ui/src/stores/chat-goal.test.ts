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
      snapshot: vi.fn((id: string) => window.zen?.session.open(id)),
      setDraft: vi.fn(),
      rename: vi.fn(),
      setWorkspace: vi.fn(),
      setMode: vi.fn(),
      setGoal: vi.fn(),
      getGoalRuntime: vi.fn().mockResolvedValue(null),
      notify: vi.fn().mockResolvedValue(undefined),
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
    chat.goalTotalTokens = 12300;
    expect(chat.goalBudgetLabel).toBe("12.3K/50K");
  });

  it("切换会话后从数据库恢复各自的目标用量，换目标时重置", async () => {
    const chat = useChatStore();
    const zen = window.zen!;
    const session = (id: string, goalText: string) => ({
      id, title: id, workspaceId: null, draft: "", pinned: false, archived: false,
      createdAt: 1, updatedAt: 1,
      goal: { text: goalText, status: "active" as const, tokenBudget: 500 },
    });
    vi.mocked(zen.session.open).mockImplementation(async (id) => ({
      session: id === "goal-a" ? session("goal-a", "A 目标") : session("goal-b", "B 目标"),
      messages: [],
    }));
    vi.mocked(zen.session.getGoalRuntime).mockImplementation(async (id) => ({
      goalText: id === "goal-a" ? "A 目标" : "B 目标",
      totalTokens: id === "goal-a" ? 120 : 35,
    }));

    await chat.loadSession(session("goal-a", "A 目标"));
    expect(chat.goalTotalTokens).toBe(120);
    expect(chat.goalBudgetLabel).toBe("120/500");
    await chat.loadSession(session("goal-b", "B 目标"));
    expect(chat.goalTotalTokens).toBe(35);
    expect(chat.goalBudgetLabel).toBe("35/500");
    await chat.loadSession(session("goal-a", "A 目标"));
    expect(chat.goalTotalTokens).toBe(120);

    await chat.setSessionGoal({ text: "新目标", status: "active", tokenBudget: 500 });
    expect(chat.goalTotalTokens).toBe(0);
    expect(chat.goalBudgetLabel).toBe("0/500");
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

describe("目标自动续跑", () => {
  it("重启后恢复的预算已耗尽时不续跑", async () => {
    const chat = useChatStore();
    const record = {
      id: "restored-goal", title: "继续目标", workspaceId: null, draft: "", pinned: false,
      archived: false, createdAt: 1, updatedAt: 1,
      goal: { text: "长期目标", status: "active" as const, tokenBudget: 100, autoContinue: true },
    };
    vi.mocked(window.zen!.session.open).mockResolvedValue({ session: record, messages: [] });
    vi.mocked(window.zen!.session.getGoalRuntime).mockResolvedValue({ goalText: "长期目标", totalTokens: 100 });
    await chat.loadSession(record);
    agentRun.mockResolvedValue({ ok: true });

    chat.input = "继续";
    await chat.send();
    chat.handleStreamEvent({ type: "done", sessionId: record.id, reason: "max_steps" });

    await vi.waitFor(() => expect(chat.sessionGoal?.status).toBe("paused"));
    expect(agentRun).toHaveBeenCalledTimes(1);
  });

  it("运行中更换目标后，旧运行的用量不记到新目标", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "旧目标", status: "active", tokenBudget: 100 });
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "开始";
    await chat.send();

    await chat.setSessionGoal({ text: "新目标", status: "active", tokenBudget: 100 });
    chat.handleStreamEvent({ type: "usage", sessionId: chat.sessionId, inputTokens: 40, outputTokens: 10 });

    expect(chat.goalTotalTokens).toBe(0);
    expect(chat.goalBudgetLabel).toBe("0/100");
  });

  it("仅在达到步数上限时续跑，连续三轮后暂停目标", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "完成登录", status: "active", tokenBudget: null, autoContinue: true });
    agentRun.mockResolvedValue({ ok: true });

    chat.input = "开始任务";
    await chat.send();
    expect(agentRun).toHaveBeenCalledTimes(1);

    for (let count = 2; count <= 4; count += 1) {
      chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "max_steps" });
      await vi.waitFor(() => expect(agentRun).toHaveBeenCalledTimes(count));
    }
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "max_steps" });
    await vi.waitFor(() => expect(chat.sessionGoal?.status).toBe("paused"));
    expect(chat.sessionGoal?.autoContinue).toBe(false);
    expect(agentRun).toHaveBeenCalledTimes(4);
  });

  it("正常结束和预算耗尽均不续跑", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "目标", status: "active", tokenBudget: 100, autoContinue: true });
    agentRun.mockResolvedValue({ ok: true });

    chat.input = "开始";
    await chat.send();
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(agentRun).toHaveBeenCalledTimes(1);

    chat.input = "继续";
    await chat.send();
    chat.handleStreamEvent({ type: "usage", sessionId: chat.sessionId, inputTokens: 60, outputTokens: 40 });
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "max_steps" });
    await vi.waitFor(() => expect(chat.sessionGoal?.status).toBe("paused"));
    expect(agentRun).toHaveBeenCalledTimes(2);
  });

  it("A 会话待续跑时切到 B，不在 B 发起 A 的任务", async () => {
    const chat = useChatStore();
    await chat.newTask();
    await chat.setSessionGoal({ text: "A 目标", status: "active", tokenBudget: null, autoContinue: true });
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "开始 A";
    await chat.send();
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "max_steps" });

    const other = {
      id: "goal-session-b", title: "B", workspaceId: null, draft: "", pinned: false,
      archived: false, createdAt: 1, updatedAt: 1,
    };
    vi.mocked(window.zen!.session.open).mockResolvedValueOnce({ session: other, messages: [] });
    await chat.loadSession(other);
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(chat.sessionId).toBe(other.id);
    expect(agentRun).toHaveBeenCalledTimes(1);
  });

  it("A 在后台达到步数上限时独立续跑，B 的会话状态与消息不被覆盖", async () => {
    const chat = useChatStore();
    await chat.newTask();
    const aId = chat.sessionId;
    const goal = { text: "A 目标", status: "active" as const, tokenBudget: null, autoContinue: true };
    await chat.setSessionGoal(goal);
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "开始 A";
    await chat.send();

    const b = {
      id: "goal-session-b", title: "B", workspaceId: null, draft: "", pinned: false,
      archived: false, createdAt: 1, updatedAt: 1,
    };
    vi.mocked(window.zen!.session.open).mockImplementation(async (id) => id === b.id
      ? { session: b, messages: [] }
      : { session: { ...b, id: aId, goal }, messages: [{ id: "a-user", role: "user", content: "开始 A", createdAt: 1 }] });
    vi.mocked(window.zen!.session.snapshot).mockImplementation(async (id) => id === b.id
      ? { session: b, messages: [] }
      : {
          session: { ...b, id: aId, goal },
          messages: [{ id: "a-user", role: "user", content: "开始 A", createdAt: 1 }],
        });
    await chat.loadSession(b);
    chat.handleStreamEvent({ type: "done", sessionId: aId, reason: "max_steps" });

    await vi.waitFor(() => expect(agentRun).toHaveBeenCalledTimes(2));
    expect(window.zen!.session.notify).not.toHaveBeenCalled();
    expect(agentRun.mock.calls[1]?.[0]).toMatchObject({ sessionId: aId, background: true });
    expect(chat.sessionId).toBe(b.id);
    expect(chat.messages).toHaveLength(0);
    expect(chat.sessionGoal).toBeNull();
  });

  it("后台最终完成只通知一次，不把提醒发给前台会话", async () => {
    const chat = useChatStore();
    await chat.newTask();
    const aId = chat.sessionId;
    const b = {
      id: "goal-session-b", title: "B", workspaceId: null, draft: "", pinned: false,
      archived: false, createdAt: 1, updatedAt: 1,
    };
    vi.mocked(window.zen!.session.open).mockResolvedValue({ session: b, messages: [] });
    await chat.loadSession(b);

    chat.handleStreamEvent({ type: "done", sessionId: aId, reason: "stop" });
    await vi.waitFor(() => expect(window.zen!.session.notify).toHaveBeenCalledTimes(1));
    expect(window.zen!.session.notify).toHaveBeenCalledWith(aId, expect.stringContaining("后台会话已完成"));
    expect(chat.sessionId).toBe(b.id);
  });
});
