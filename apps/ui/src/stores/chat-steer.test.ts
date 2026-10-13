// 运行中转向（steer）编排回归：
// - 运行中发送文本 → 走 agent.steer（不再静默入队），气泡带 meta.steer 徽标；
// - steer 被拒（等审批/无运行中 run）→ 消息退回队列不丢，insertActive 复位；
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
});

describe("运行中发送 = 转向编排", () => {
  it("运行中文本消息走 agent.steer：本地消息带 meta.steer，输入清空", async () => {
    const chat = useChatStore();

    // 先造一个运行中的会话
    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);

    agentSteer.mockResolvedValueOnce({ ok: true });
    chat.input = "改成先做后端接口";
    await chat.send();

    expect(agentSteer).toHaveBeenCalledWith(chat.sessionId, "改成先做后端接口");
    expect(chat.isRunning).toBe(true);
    expect(chat.input).toBe("");
    // 本地乐观展示的转向消息（带 steer 徽标标记）
    const steerMessage = chat.messages.find((message) => message.content === "改成先做后端接口");
    expect((steerMessage?.meta as { steer?: boolean } | undefined)?.steer).toBe(true);
    // 不再静默入队
    expect(chat.queuedMessages).toHaveLength(0);
  });

  it("steer 被拒（主进程无运行中 run）：消息退回队列，气泡撤下", async () => {
    const chat = useChatStore();

    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "长任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);

    agentSteer.mockResolvedValueOnce({ ok: false, error: "正在等待工具审批，暂时不能插入执行" });
    chat.input = "补充指示";
    await chat.send();

    expect(agentSteer).toHaveBeenCalled();
    // 注入被拒：insertActive 复位（不会永久卡 running），消息退回队列不丢
    expect(chat.insertActive).toBe(false);
    expect(chat.queuedMessages).toHaveLength(1);
    expect(chat.queuedMessages[0]?.text).toBe("补充指示");
    expect(chat.messages.some((message) => message.content === "补充指示")).toBe(false);
    expect(chat.lastError).toContain("等待工具审批");
  });

  it("运行中带附件的消息回退队列（转向不支持附件）", async () => {
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
    // 本地落一条普通用户消息（不带 steer 徽标）
    const approval = chat.messages.find((message) => message.content === "批准执行");
    expect(approval?.role).toBe("user");
    expect((approval?.meta as { steer?: boolean } | undefined)?.steer).toBeUndefined();
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
