import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ZenApi } from "@/types/zen-api";
import type {
  SideChatMessage,
  SideChatModelRef,
  SideChatRecord,
  SideChatStreamEvent,
} from "@zen/shared";

/** 主进程桥：与 apps/desktop/src/preload/side-chat.ts、zen-api 的 sideChat 段一致 */
type SideChatBridge = ZenApi["sideChat"];

/** 进行中的一轮：用户原文（主进程落库前） + 流式助手文本 + 失败原因 */
export interface SideChatLive {
  userText: string;
  text: string;
  error: string;
  running: boolean;
}

export interface SideChatSendResult {
  ok: boolean;
  error?: string;
}

function bridge(): SideChatBridge | null {
  return window.zen?.sideChat ?? null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 本地消息 id：done 事件只带助手消息，用户那条在落库前由渲染层补位（重开时以主进程为准） */
let localSeq = 0;
function localMessageId(role: "user" | "assistant", at: number): string {
  localSeq += 1;
  return `local-${role}-${at}-${localSeq}`;
}

/**
 * 侧边对话：挂在某个主会话旁、独立落库的对话。
 * - 自己的消息 / 草稿 / 模型全在 SideChatRecord 里，读写都不经过 chat store；
 * - 关闭标签只关视图（right-panel 负责），记录从这里按会话重新列出；
 * - 一轮续写期间只在 live 里画「用户原文 + 流式增量」，结束后才并入 messages，
 *   这样草稿/模型的落库永远不会拿未完成的 messages 覆盖主进程。
 */
export const useSideChatStore = defineStore("sideChat", () => {
  const records = ref<Map<string, SideChatRecord>>(new Map());
  /** 进行中（或刚失败）的一轮，key = 侧聊 id */
  const live = ref<Map<string, SideChatLive>>(new Map());
  /** 输入框当前文本（按侧聊 id 隔离；与 record.draft 同步） */
  const drafts = ref<Map<string, string>>(new Map());
  /** 当前挂靠的主会话：load() 设置，ensureLoaded 在记录缺失时用它回源 */
  const sessionId = ref("");
  const loading = ref(false);
  const error = ref("");

  /** 一轮进行中跳过落库的侧聊：结束（done/error/stopped）后补写草稿与模型 */
  const pendingPersist = new Set<string>();
  let unbindStream: (() => void) | null = null;
  let mounts = 0;

  /** 当前会话的侧聊：最近更新在前 */
  const list = computed(() =>
    [...records.value.values()]
      .filter((record) => record.sessionId === sessionId.value)
      .sort((left, right) => right.updatedAt - left.updatedAt),
  );

  function recordOf(id: string): SideChatRecord | null {
    return records.value.get(id) ?? null;
  }

  function liveOf(id: string): SideChatLive | null {
    return live.value.get(id) ?? null;
  }

  function draftOf(id: string): string {
    return drafts.value.get(id) ?? recordOf(id)?.draft ?? "";
  }

  function isRunning(id: string): boolean {
    return live.value.get(id)?.running ?? false;
  }

  function setError(err: unknown): void {
    error.value = message(err);
  }

  /**
   * 把本地记录整条写给主进程（草稿/模型变更）。
   * 一轮进行中先挂起：主进程在 run 结束时会重读记录再写回，
   * 此时用未完成的 messages 覆盖会丢这一轮。
   */
  function persist(id: string): void {
    const api = bridge();
    const record = recordOf(id);
    if (!api || !record) {
      return;
    }
    if (isRunning(id)) {
      pendingPersist.add(id);
      return;
    }
    void api
      .save({
        ...record,
        draft: draftOf(id),
        messages: record.messages,
      })
      .catch(setError);
  }

  function flushPending(id: string): void {
    if (pendingPersist.delete(id)) {
      persist(id);
    }
  }

  /** 按主会话加载侧聊列表（会话切换时调用；已有记录快照保留，同 id 以主进程为准） */
  async function load(id: string): Promise<void> {
    sessionId.value = id ?? "";
    const api = bridge();
    if (!api || !sessionId.value) {
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      const result = await api.list(sessionId.value);
      const target = sessionId.value;
      const next = new Map<string, SideChatRecord>();
      // 其它会话的已加载记录不动（标签可能还挂着），本会话以主进程结果为准
      for (const [recordId, record] of records.value) {
        if (record.sessionId !== target) {
          next.set(recordId, record);
        }
      }
      for (const chat of result.chats) {
        next.set(chat.id, chat);
        if (!drafts.value.has(chat.id) && !isRunning(chat.id)) {
          drafts.value.set(chat.id, chat.draft ?? "");
        }
      }
      records.value = next;
    } catch (err) {
      setError(err);
    } finally {
      loading.value = false;
    }
  }

  async function create(chatSessionId: string): Promise<SideChatRecord | null> {
    const api = bridge();
    if (!api || !chatSessionId) {
      return null;
    }
    try {
      const record = await api.create(chatSessionId);
      // 没走 load 时（启动后直接新建）也把当前会话对齐，列表 / 历史才有内容
      if (!sessionId.value) {
        sessionId.value = chatSessionId;
      }
      records.value.set(record.id, record);
      drafts.value.set(record.id, record.draft ?? "");
      return record;
    } catch (err) {
      setError(err);
      return null;
    }
  }

  /** 打开指定记录：本地没有就回源当前会话列表（重启后标签恢复走这里） */
  async function ensureLoaded(id: string): Promise<void> {
    if (!id || records.value.has(id)) {
      return;
    }
    if (sessionId.value && !loading.value) {
      await load(sessionId.value);
    }
  }

  async function open(id: string): Promise<SideChatRecord | null> {
    await ensureLoaded(id);
    return recordOf(id);
  }

  /**
   * 面板全部卸载期间结束的轮次收不到 done/error（广播只发给当前订阅者）：
   * 重新挂载时按落库消息对齐一次，消息变多说明这轮已结束，清掉卡住的 live；
   * 还在跑则保留 live，续上后续增量。
   */
  async function reconcileLive(): Promise<void> {
    const api = bridge();
    if (!api) {
      return;
    }
    for (const [id, state] of [...live.value]) {
      const record = recordOf(id);
      if (!state.running || !record) {
        continue;
      }
      try {
        const result = await api.list(record.sessionId);
        const fresh = result.chats.find((chat) => chat.id === id);
        if (fresh && fresh.messages.length > record.messages.length) {
          records.value.set(id, fresh);
          live.value.delete(id);
          flushPending(id);
        }
      } catch {
        // 读不到就保持现状，等后续事件收尾
      }
    }
  }

  function bindStream(): () => void {
    mounts += 1;
    if (!unbindStream) {
      const api = bridge();
      if (api) {
        unbindStream = api.onStream(handleStream);
        void reconcileLive();
      }
    }
    return () => {
      mounts -= 1;
      if (mounts <= 0) {
        mounts = 0;
        unbindStream?.();
        unbindStream = null;
      }
    };
  }

  /** 一轮结束：用户原文 + 助手消息并入 messages，清掉 live 并补写挂起的草稿 */
  function commitTurn(id: string, assistant: SideChatMessage): void {
    const record = recordOf(id);
    const current = liveOf(id);
    if (record) {
      const at = Date.now();
      const turn: SideChatMessage[] = [];
      if (current?.userText) {
        turn.push({
          id: localMessageId("user", at),
          role: "user",
          text: current.userText,
          at,
        });
      }
      turn.push(assistant);
      record.messages = [...record.messages, ...turn];
      record.updatedAt = at;
      live.value.delete(id);
    } else if (current) {
      // 记录已被删/未加载：保留失败原因，避免把错误吞掉
      current.running = false;
      current.error = assistant.error ?? current.error;
    }
    flushPending(id);
  }

  function handleStream(event: SideChatStreamEvent): void {
    const current = liveOf(event.id);
    if (event.type === "delta") {
      if (current) {
        current.text += event.text;
      } else {
        live.value.set(event.id, { userText: "", text: event.text, error: "", running: true });
      }
      return;
    }
    const at = Date.now();
    if (event.type === "done") {
      commitTurn(event.id, event.message);
      return;
    }
    if (event.type === "error") {
      commitTurn(event.id, {
        id: localMessageId("assistant", at),
        role: "assistant",
        text: current?.text ?? "",
        at,
        error: event.error,
      });
      return;
    }
    // stopped：主进程已把已生成的部分落库，本地按同样内容收尾（重开以主进程为准）
    commitTurn(event.id, {
      id: localMessageId("assistant", at),
      role: "assistant",
      text: current?.text ?? "",
      at,
    });
  }

  async function send(id: string, text: string): Promise<SideChatSendResult> {
    const api = bridge();
    const body = text.trim();
    if (!api) {
      return { ok: false, error: "window.zen.sideChat unavailable" };
    }
    if (!body) {
      return { ok: false };
    }
    if (!recordOf(id)) {
      return { ok: false, error: "侧边对话不存在" };
    }
    if (isRunning(id)) {
      return { ok: false, error: "正在回答中" };
    }
    // 消息交给主进程落库，输入框立即清空；失败时回填原文（草稿不丢）
    drafts.value.set(id, "");
    live.value.set(id, { userText: body, text: "", error: "", running: true });
    try {
      const result = await api.send(id, body);
      if (!result.ok) {
        live.value.delete(id);
        restoreDraft(id, body);
        return { ok: false, error: result.error };
      }
      return { ok: true };
    } catch (err) {
      live.value.delete(id);
      restoreDraft(id, body);
      return { ok: false, error: message(err) };
    }
  }

  function restoreDraft(id: string, text: string): void {
    drafts.value.set(id, text);
    const record = recordOf(id);
    if (record) {
      record.draft = text;
    }
    persist(id);
  }

  async function stop(id: string): Promise<void> {
    const api = bridge();
    if (!api || !isRunning(id)) {
      return;
    }
    try {
      await api.stop(id);
    } catch (err) {
      setError(err);
    }
  }

  /** 输入框停顿/失焦：记到草稿并按需落库（进行中挂起，结束时补写） */
  function saveDraft(id: string, text: string): void {
    drafts.value.set(id, text);
    const record = recordOf(id);
    if (record) {
      record.draft = text;
    }
    persist(id);
  }

  async function setModel(
    id: string,
    model: SideChatModelRef | null,
    effort: string | null,
  ): Promise<void> {
    const record = recordOf(id);
    if (!record) {
      return;
    }
    record.model = model;
    record.effort = effort;
    const api = bridge();
    if (!api) {
      return;
    }
    try {
      await api.setModel(id, model, effort);
    } catch (err) {
      setError(err);
    }
  }

  async function remove(id: string): Promise<SideChatSendResult> {
    const api = bridge();
    if (!api) {
      return { ok: false, error: "window.zen.sideChat unavailable" };
    }
    try {
      const result = await api.remove(id);
      if (result.ok === false) {
        return { ok: false, error: "侧边对话不存在" };
      }
      records.value.delete(id);
      live.value.delete(id);
      drafts.value.delete(id);
      pendingPersist.delete(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  return {
    records,
    live,
    drafts,
    sessionId,
    loading,
    error,
    list,
    recordOf,
    liveOf,
    draftOf,
    isRunning,
    load,
    create,
    ensureLoaded,
    open,
    bindStream,
    send,
    stop,
    saveDraft,
    setModel,
    remove,
  };
});
