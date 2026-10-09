// 复现/回归：发送时 agent:run 失败（IPC 抛错或 {ok:false}）不得卡死运行态。
// 此前 status 停在 thinking、侧栏 sessionStatus 停在 running：后续发送全被
// isRunning 守卫静默拦进队列（表现为「发送没有任何反应」），侧栏一直转圈。
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useSessionStatusStore } from "@/stores/session-status";

const agentRun = vi.fn();
const agentInsert = vi.fn();

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: agentRun,
      insert: agentInsert,
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

describe("send 运行启动失败复位", () => {
  it("agent.run 抛错：运行态复位、错误可见，且可再次发送（不被拦进队列）", async () => {
    const chat = useChatStore();
    const sessionStatus = useSessionStatusStore();

    agentRun.mockRejectedValueOnce(new Error("database is locked"));
    chat.input = "第一条消息";
    await chat.send();

    expect(chat.isRunning).toBe(false);
    expect(chat.status).toBe("error");
    expect(chat.lastError).toContain("database is locked");
    expect(sessionStatus.get(chat.sessionId)).toBe("error");

    // 第二次发送必须真正触发 agent.run，而不是静默进队列
    agentRun.mockResolvedValueOnce({ ok: true });
    chat.input = "第二条消息";
    await chat.send();
    expect(agentRun).toHaveBeenCalledTimes(2);
    expect(chat.queuedMessages).toHaveLength(0);
  });

  it("agent.run 返回 {ok:false}：侧栏运行态落 error，不再停在 running", async () => {
    const chat = useChatStore();
    const sessionStatus = useSessionStatusStore();

    agentRun.mockResolvedValueOnce({ ok: false, error: "session not found" });
    chat.input = "失败的发送";
    await chat.send();

    expect(chat.isRunning).toBe(false);
    expect(sessionStatus.get(chat.sessionId)).toBe("error");
    expect(chat.lastError).toBe("session not found");
  });
});

describe("insertQueued 启动失败复位", () => {
  it("agent.insert 抛错：insertActive 复位、消息退回队首", async () => {
    const chat = useChatStore();

    // 先造一个运行中的会话（isRunning=true 才允许插入执行）
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "长任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);

    chat.input = "插入的消息";
    await chat.send();
    expect(chat.queuedMessages).toHaveLength(1);
    const queued = chat.queuedMessages[0];
    expect(queued?.text).toBe("插入的消息");
    if (!queued) {
      throw new Error("队列应有一条插入消息");
    }

    agentInsert.mockRejectedValueOnce(new Error("bridge 挂了"));
    await chat.insertQueued(queued.id);

    expect(chat.insertActive).toBe(false);
    expect(chat.queuedMessages).toHaveLength(1);
    expect(chat.queuedMessages[0]?.text).toBe("插入的消息");
    expect(chat.lastError).toContain("bridge 挂了");
  });
});
