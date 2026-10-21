// 回归（历史会话发起对话「只 loading 没反应」根因修复）：
// - 审批卡随会话暂存/恢复：切走带挂起审批的会话再切回，审批卡必须重新出现，
//   否则主进程等不到决定，会话停在 awaiting-approval，发送全被静默拦进队列；
// - 后台会话新到的 approval_request 记入暂存，切回时恢复；
// - 插入执行失败（主进程已无 run）必须复位运行态，否则 isRunning 永久为 true，
//   后续发送全部无声进队且永不派发；
// - 发起对话后本地同步 updatedAt 并重排：侧栏立即把该会话排到组内顶部。
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useSessionStatusStore } from "@/stores/session-status";
import { useWorkspaceStore } from "@/stores/workspace";
import type { SessionRecord } from "@zen/shared";

const agentRun = vi.fn();
const agentInsert = vi.fn();

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "hist-1",
    title: "历史会话",
    workspaceId: null,
    draft: "",
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: agentRun,
      insert: agentInsert,
      resolveApproval: vi.fn().mockResolvedValue({ ok: true }),
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

describe("审批卡随会话暂存/恢复", () => {
  it("切走带挂起审批的会话再切回：审批卡恢复，不再卡死在等审批", async () => {
    const chat = useChatStore();
    const zen = window.zen;

    // 会话 A 运行中收到审批请求（前台路径）
    const aId = chat.sessionId;
    chat.handleStreamEvent({
      type: "approval_request",
      sessionId: chat.sessionId,
      request: {
        approvalId: "ap-1",
        toolCallId: "tc-1",
        toolName: "runTerminal",
        reason: "要执行命令",
        input: { command: "rm -rf /tmp/x" },
      },
    });
    expect(chat.pendingApproval?.approvalId).toBe("ap-1");

    // 切到历史会话 B：A 的审批卡应被暂存
    const target = sessionRecord({ id: "hist-1" });
    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { id: "hist-1", title: "B", workspaceId: null, draft: "", mode: "interactive" },
      messages: [],
      taskLists: [],
    });
    await chat.loadSession(target);
    expect(chat.pendingApproval).toBeNull();

    // 切回 A：审批卡恢复出来，用户能做决定
    const back = sessionRecord({ id: aId, title: "A" });
    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { id: back.id, title: "A", workspaceId: null, draft: "", mode: "interactive" },
      messages: [],
      taskLists: [],
    });
    await chat.loadSession(back);
    // 恢复的是切走时暂存的审批卡
    expect(chat.pendingApproval?.approvalId).toBe("ap-1");
  });

  it("后台会话新到的 approval_request 记入暂存：切回时恢复审批卡", async () => {
    const chat = useChatStore();
    const zen = window.zen;
    const sessionStatus = useSessionStatusStore();

    // 当前在 A；后台会话 B 收到审批请求
    chat.handleStreamEvent({
      type: "approval_request",
      sessionId: "hist-1",
      request: {
        approvalId: "ap-2",
        toolCallId: "tc-2",
        toolName: "runTerminal",
        reason: "后台要执行命令",
        input: { command: "ls" },
      },
    });
    expect(sessionStatus.get("hist-1")).toBe("needs_action");
    // 当前会话（A）的审批卡不受影响
    expect(chat.pendingApproval).toBeNull();

    // 切到 B：审批卡恢复
    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { id: "hist-1", title: "B", workspaceId: null, draft: "", mode: "interactive" },
      messages: [],
      taskLists: [],
    });
    await chat.loadSession(sessionRecord({ id: "hist-1" }));
    expect(chat.pendingApproval?.approvalId).toBe("ap-2");
  });
});

describe("插入执行失败复位", () => {
  it("agent.insert 返回 session not running：状态复位 idle，后续发送不再被拦进队列", async () => {
    const chat = useChatStore();

    // 造一个运行中的会话（isRunning=true 才允许插入）
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "长任务";
    await chat.send();
    expect(chat.isRunning).toBe(true);

    chat.input = "排队消息";
    await chat.send();
    expect(chat.queuedMessages).toHaveLength(1);
    const queued = chat.queuedMessages[0];
    if (!queued) {
      throw new Error("队列应有排队消息");
    }

    // 主进程已无此 run（run 结束但 UI 状态失联）：插入被拒
    agentInsert.mockResolvedValueOnce({ ok: false, error: "session not running" });
    await chat.insertQueued(queued.id);

    // 运行态复位：不再「只 loading」，消息退回队列可手动处理
    expect(chat.insertActive).toBe(false);
    expect(chat.status).toBe("idle");
    expect(chat.isRunning).toBe(false);
    expect(sessionStatusOf(chat)).toBe("done");

    // 后续发送走正常 run 而不是被拦进队列
    agentRun.mockClear();
    agentRun.mockResolvedValue({ ok: true });
    chat.input = "新消息";
    await chat.send();
    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(chat.queuedMessages.every((item) => item.text !== "新消息")).toBe(true);
  });
});

function sessionStatusOf(chat: ReturnType<typeof useChatStore>): string {
  return useSessionStatusStore().get(chat.sessionId);
}

describe("发起对话即置顶（本地 updatedAt 同步）", () => {
  it("在低置底的历史会话中发送：workspace 分组内该会话排序到未置顶区顶部", async () => {
    const chat = useChatStore();
    const workspaceStore = useWorkspaceStore();
    const zen = window.zen;

    // 组内已有更新的会话在前
    workspaceStore.groups = [
      {
        id: "common",
        name: "公共区",
        kind: "common",
        path: null,
        archived: false,
        pinned: false,
        createdAt: 1,
        sessions: [
          sessionRecord({ id: "newer", title: "更新", updatedAt: 200 }),
          sessionRecord({ id: "hist-1", title: "历史会话", updatedAt: 100 }),
        ],
      },
    ];

    (zen?.session.open as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { id: "hist-1", title: "历史会话", workspaceId: null, draft: "", mode: "interactive" },
      messages: [],
      taskLists: [],
    });
    await chat.loadSession(sessionRecord({ id: "hist-1", updatedAt: 100 }));

    agentRun.mockResolvedValue({ ok: true });
    chat.input = "重新发起对话";
    await chat.send();

    // 本地记录的 updatedAt 被刷新并重排：hist-1 排到未置顶区顶部
    const group = workspaceStore.groups[0];
    const ids = (group?.sessions ?? []).filter((item) => !item.pinned).map((item) => item.id);
    expect(ids[0]).toBe("hist-1");
  });
});
