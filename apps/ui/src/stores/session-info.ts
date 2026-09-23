import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ReferenceItem, TaskItem, TaskListVersion } from "@zen/shared";
import { useChatStore } from "@/stores/chat";

let taskSeq = 0;
let refSeq = 0;

function nextTaskId(): string {
  taskSeq += 1;
  return `t${taskSeq}`;
}

function nextRefId(): string {
  refSeq += 1;
  return `r${refSeq}`;
}

/**
 * 会话信息卡数据：任务清单版本与 websearch 参考。
 * 按 sessionId 隔离，切会话时切换/清空。
 */
export const useSessionInfoStore = defineStore("sessionInfo", () => {
  const versions = ref<TaskListVersion[]>([]);
  const activeVersionId = ref("");
  const references = ref<ReferenceItem[]>([]);
  const ownerSessionId = ref("");

  const activeVersion = computed(
    () => versions.value.find((item) => item.id === activeVersionId.value) ?? null,
  );
  const activeTasks = computed(() => activeVersion.value?.items ?? []);
  const doneCount = computed(() => activeTasks.value.filter((item) => item.done).length);

  function ensureSession(sessionId: string) {
    if (ownerSessionId.value && ownerSessionId.value !== sessionId) {
      versions.value = [];
      activeVersionId.value = "";
      references.value = [];
    }
    ownerSessionId.value = sessionId;
  }

  /**
   * 应用一次任务清单更新。
   * 带 agentName（子 Agent 侧信道事件）：不做整列表替换，而是按 item id
   * upsert 合并进当前激活版本（无激活版本则新建 v1），条目保留 agentName。
   * 不带 agentName（主 Agent）：行为与原先一致，按 version 整列表替换。
   */
  function applyTasksUpdated(
    sessionId: string,
    version: number,
    items: TaskItem[],
    agentName?: string,
  ) {
    ensureSession(sessionId);
    if (agentName) {
      let target = activeVersion.value;
      if (!target) {
        const created: TaskListVersion = {
          id: nextTaskId(),
          version: 1,
          items: [],
          createdAt: Date.now(),
        };
        versions.value.push(created);
        activeVersionId.value = created.id;
        target = created;
      }
      const merged = [...target.items];
      for (const item of items) {
        const index = merged.findIndex((existing) => existing.id === item.id);
        const tagged: TaskItem = { ...item, agentName };
        if (index >= 0) {
          merged[index] = tagged;
        } else {
          merged.push(tagged);
        }
      }
      target.items = merged;
      return;
    }
    const existing = versions.value.find((item) => item.version === version);
    if (existing) {
      existing.items = items;
      activeVersionId.value = existing.id;
      return;
    }
    const created: TaskListVersion = {
      id: nextTaskId(),
      version,
      items,
      createdAt: Date.now(),
    };
    versions.value.push(created);
    activeVersionId.value = created.id;
  }

  function addReference(sessionId: string, reference: ReferenceItem) {
    ensureSession(sessionId);
    if (references.value.some((item) => item.url === reference.url)) {
      return;
    }
    references.value.push({ ...reference, id: reference.id || nextRefId() });
  }

  function clear() {
    versions.value = [];
    activeVersionId.value = "";
    references.value = [];
    ownerSessionId.value = "";
  }

  /**
   * 从会话打开结果恢复任务清单（含消息流里的 tasks 快照，兼容旧数据）。
   */
  function restoreFromSession(payload: {
    messages: Array<{
      role: string;
      meta?: Record<string, unknown> | null;
    }>;
    taskLists?: Array<{ version: number; items: TaskItem[]; createdAt?: number }>;
  }) {
    const sessionId = useChatStore().sessionId;
    ensureSession(sessionId);
    versions.value = [];
    activeVersionId.value = "";

    const source =
      payload.taskLists?.length
        ? payload.taskLists.map((item) => ({
            version: item.version,
            items: item.items,
            createdAt: item.createdAt ?? Date.now(),
          }))
        : payload.messages.flatMap((message) => {
            const meta = message.meta as
              | { kind?: string; version?: number; items?: TaskItem[] }
              | undefined;
            if (message.role !== "tool" || meta?.kind !== "tasks" || !Array.isArray(meta.items)) {
              return [];
            }
            return [
              {
                version: meta.version ?? 1,
                items: meta.items,
                createdAt: Date.now(),
              },
            ];
          });

    for (const item of source) {
      const created: TaskListVersion = {
        id: nextTaskId(),
        version: item.version,
        items: item.items,
        createdAt: item.createdAt,
      };
      versions.value.push(created);
      activeVersionId.value = created.id;
    }
  }

  /** 会话变更时由 chat store 调用 */
  function syncFromChat() {
    const sessionId = useChatStore().sessionId;
    ensureSession(sessionId);
  }

  return {
    versions,
    activeVersionId,
    references,
    ownerSessionId,
    activeVersion,
    activeTasks,
    doneCount,
    applyTasksUpdated,
    addReference,
    clear,
    restoreFromSession,
    syncFromChat,
    ensureSession,
  };
});
