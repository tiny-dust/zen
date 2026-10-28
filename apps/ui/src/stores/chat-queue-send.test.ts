// 运行中发送默认排队（回归）：
// - 运行中发送文本/附件消息 → 一并入队（不打断当前 run），输入框与附件清空；
// - run 正常结束后队列按序自动续发（还原正文与附件，走 agent.run）；
// - 「立即插入」仍走 agent.insert（打断当前任务 → 先跑这条 → 自动恢复），
//   带附件的排队消息不支持插入执行（插入通道只传文本）；
// - 计划模式批准 → 以「批准执行」用户消息 + approvePlan 标记走 agent.run。
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";

const agentRun = vi.fn();
const agentInsert = vi.fn();
const agentSteer = vi.fn();

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: agentRun,
      insert: agentInsert,
      steer: agentSteer,
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
  // 发送路径前置：模型已选中，跳过 modelsStore.refresh
  const models = useModelsStore();
  models.selection = { providerId: "p1", modelId: "m1" };
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("运行中发送 = 排队编排", () => {
  it("运行中文本消息入队：不打断当前 run，输入清空并提示已排队", async () => {
    const chat = useChatStore();

    // 先造一个运行中的会话
    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);

    chat.input = "补充一条指示";
    await chat.send();

    // 不再转向：不打断当前 run，消息进队列等自动续发
    expect(agentSteer).not.toHaveBeenCalled();
    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(chat.queuedMessages.map((item) => item.text)).toEqual(["补充一条指示"]);
    expect(chat.input).toBe("");
    expect(chat.statusText).toContain("队列");
    // 队列消息尚未发出：不提前落本地气泡
    expect(chat.messages.some((message) => message.content === "补充一条指示")).toBe(false);
  });

  it("运行中带附件的消息随队列快照保存，composer 附件清空", async () => {
    const chat = useChatStore();

    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();

    chat.addAttachment(
      { name: "截图.png", type: "image/png", size: 10 } as unknown as File,
      "/tmp/截图.png",
    );
    chat.input = "看这张图";
    await chat.send();

    expect(agentSteer).not.toHaveBeenCalled();
    expect(chat.queuedMessages).toHaveLength(1);
    expect(chat.queuedMessages[0]?.text).toBe("看这张图");
    expect(chat.queuedMessages[0]?.attachments?.map((item) => item.name)).toEqual(["截图.png"]);
    expect(chat.attachments).toEqual([]);
  });

  it("run 正常结束后队列自动续发：还原正文与附件走 agent.run", async () => {
    vi.useFakeTimers();
    const chat = useChatStore();

    agentRun.mockResolvedValue({ ok: true });
    chat.input = "长任务";
    await chat.send();

    chat.addAttachment(
      { name: "截图.png", type: "image/png", size: 10 } as unknown as File,
      "/tmp/截图.png",
    );
    chat.input = "看这张图";
    await chat.send();
    expect(chat.queuedMessages).toHaveLength(1);

    // run 正常结束（非取消/出错）→ 稍候自动续发队首
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "stop" });
    await vi.advanceTimersByTimeAsync(400);

    expect(agentSteer).not.toHaveBeenCalled();
    expect(agentRun).toHaveBeenCalledTimes(2);
    const request = agentRun.mock.calls[1]?.[0] as {
      userMessage: string;
      attachments?: Array<{ name: string; path: string }>;
    };
    expect(request.userMessage).toBe("看这张图");
    expect(request.attachments?.map((item) => item.name)).toEqual(["截图.png"]);
    expect(chat.queuedMessages).toHaveLength(0);
  });

  it("「立即插入」仍走 agent.insert：打断当前任务，先跑这条", async () => {
    const chat = useChatStore();

    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();

    chat.input = "插队的消息";
    await chat.send();
    const queued = chat.queuedMessages[0];
    if (!queued) {
      throw new Error("队列应有一条插入消息");
    }

    agentInsert.mockResolvedValueOnce({ ok: true });
    await chat.insertQueued(queued.id);

    expect(agentInsert).toHaveBeenCalledWith(chat.sessionId, "插队的消息");
    expect(chat.insertActive).toBe(true);
    expect(chat.queuedMessages).toHaveLength(0);
  });

  it("后台正常结束的会话切回后：暂存的队列消息补续发", async () => {
    vi.useFakeTimers();
    const chat = useChatStore();
    const firstId = chat.sessionId;

    agentRun.mockResolvedValue({ ok: true });
    chat.input = "长任务";
    await chat.send();

    chat.input = "补充指示";
    await chat.send();
    expect(chat.queuedMessages).toHaveLength(1);

    // 切到新会话：原 run 后台继续跑，队列随会话暂存
    await chat.newTask();
    expect(chat.sessionId).not.toBe(firstId);
    expect(chat.queuedMessages).toHaveLength(0);

    // 原会话在后台正常结束：done 走后台分支（非当前会话）
    chat.handleStreamEvent({ type: "done", sessionId: firstId, reason: "stop" });

    // 切回原会话：队列从暂存恢复，会话已不在运行
    const zen = window.zen;
    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { id: firstId, title: "T", workspaceId: null, draft: "", mode: "interactive" },
      messages: [],
    });
    await chat.loadSession({
      id: firstId,
      title: "T",
      workspaceId: null,
      draft: "",
      pinned: false,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(chat.queuedMessages.map((item) => item.text)).toEqual(["补充指示"]);
    expect(chat.isRunning).toBe(false);

    // 切回后应补一次队列续发：恢复的消息自动发出，不用再手动发送/插入
    await vi.advanceTimersByTimeAsync(400);
    const request = agentRun.mock.calls.at(-1)?.[0] as {
      sessionId?: string;
      userMessage?: string;
    };
    expect(request?.sessionId).toBe(firstId);
    expect(request?.userMessage).toBe("补充指示");
    expect(chat.queuedMessages).toHaveLength(0);
  });

  it("带附件的排队消息不支持「立即插入」：不打断，等队列轮到自动发送", async () => {
    const chat = useChatStore();

    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();

    chat.addAttachment(
      { name: "截图.png", type: "image/png", size: 10 } as unknown as File,
      "/tmp/截图.png",
    );
    chat.input = "看这张图";
    await chat.send();
    const queued = chat.queuedMessages[0];
    if (!queued) {
      throw new Error("队列应有一条插入消息");
    }

    await chat.insertQueued(queued.id);

    expect(agentInsert).not.toHaveBeenCalled();
    expect(chat.queuedMessages).toHaveLength(1);
    expect(chat.isRunning).toBe(true);
  });
});

describe("计划模式批准编排", () => {
  it("approvePlan 以「批准执行」消息 + approvePlan 标记发起 run", async () => {
    const chat = useChatStore();
    await chat.setSessionMode("plan");
    expect(chat.sessionMode).toBe("plan");

    agentRun.mockResolvedValueOnce({ ok: true });
    await chat.approvePlan();

    expect(agentRun).toHaveBeenCalledTimes(1);
    const request = agentRun.mock.calls[0]?.[0] as { userMessage: string; approvePlan?: boolean };
    expect(request.userMessage).toBe("批准执行");
    expect(request.approvePlan).toBe(true);
    // 本地落一条普通用户消息
    const approval = chat.messages.find((message) => message.content === "批准执行");
    expect(approval?.role).toBe("user");
  });

  it("非 plan 模式下 approvePlan 不发送", async () => {
    const chat = useChatStore();

    await chat.approvePlan();
    expect(agentRun).not.toHaveBeenCalled();
  });

  it("setSessionMode 持久化到 session.setMode", async () => {
    const chat = useChatStore();
    // 先落库（ensurePersistedSession 已在 send 时补建过；这里直接补一次 create）
    await chat.newTask();

    await chat.setSessionMode("autopilot");
    expect(chat.sessionMode).toBe("autopilot");

    const zen = window.zen;
    expect(zen?.session.setMode).toHaveBeenCalledWith(chat.sessionId, "autopilot");
  });
});

// 回归：发送前置有多次 await（补建会话/刷新模型/分叉截断），这段窗口里运行态还是 idle，
// 双击发送按钮或 Enter 连按会让两次调用都通过校验，各追加一条相同用户气泡 + 各起一次 run。
describe("重复触发发送不重入", () => {
  it("连点两次发送：只落一条用户气泡、只起一次 run", async () => {
    const chat = useChatStore();
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "server 端代码改动到哪里了？";

    // 不 await 第一次：模拟第二次点击落在第一次的 await 窗口内
    const first = chat.send();
    const second = chat.send();
    await Promise.all([first, second]);

    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(
      chat.messages.filter((message) => message.content === "server 端代码改动到哪里了？"),
    ).toHaveLength(1);
    expect(chat.input).toBe("");
  });

  it("本轮结束后重入保护复位，下一轮照常发送", async () => {
    const chat = useChatStore();
    agentRun.mockResolvedValue({ ok: true });

    chat.input = "第一条";
    await chat.send();
    // run 正常结束：运行态回 idle
    chat.handleStreamEvent({ type: "done", sessionId: chat.sessionId, reason: "stop" });

    chat.input = "第二条";
    await chat.send();

    expect(agentRun).toHaveBeenCalledTimes(2);
    expect(
      chat.messages.filter((message) => message.role === "user").map((message) => message.content),
    ).toEqual(["第一条", "第二条"]);
  });
});
