import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ReferenceItem, TaskItem, TaskListVersion } from "@zen/shared";
import { useChatStore } from "@/stores/chat";
import { createSessionBuckets } from "@/stores/session-buckets";
import { siteKey } from "@/lib/site-url";

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

/** 单个会话的信息卡状态（分桶快照） */
interface SessionInfoBucketState {
  versions: TaskListVersion[];
  activeVersionId: string;
  references: ReferenceItem[];
}

/**
 * 会话信息卡数据：任务清单版本与 websearch 参考。
 * 按 sessionId 分桶隔离；切会话时暂存，切回时恢复（不再清空丢数据）。
 */
export const useSessionInfoStore = defineStore("sessionInfo", () => {
  const versions = ref<TaskListVersion[]>([]);
  const activeVersionId = ref("");
  const references = ref<ReferenceItem[]>([]);

  const buckets = createSessionBuckets<SessionInfoBucketState>({
    initial: () => ({ versions: [], activeVersionId: "", references: [] }),
    capture: () => ({
      versions: versions.value,
      activeVersionId: activeVersionId.value,
      references: references.value,
    }),
    restore: (state) => {
      versions.value = state.versions;
      activeVersionId.value = state.activeVersionId;
      references.value = state.references;
    },
  });
  const ownerSessionId = computed(() => buckets.activeKey);

  const activeVersion = computed(
    () => versions.value.find((item) => item.id === activeVersionId.value) ?? null,
  );
  const activeTasks = computed(() => activeVersion.value?.items ?? []);
  const doneCount = computed(() => activeTasks.value.filter((item) => item.done).length);

  /** 切换会话：旧会话信息卡入桶，目标会话恢复自己的任务清单与参考 */
  function ensureSession(sessionId: string) {
    buckets.switchTo(sessionId);
  }

  /**
   * 事件落点：事件属于当前查看的会话才直接改 refs；
   * 后台会话的事件写进其桶（切回时恢复），绝不切换当前视图。
   */
  function applyToSession(sessionId: string, mutate: (state: SessionInfoBucketState) => void) {
    if (sessionId === buckets.activeKey) {
      mutate({
        get versions() {
          return versions.value;
        },
        set versions(next) {
          versions.value = next;
        },
        get activeVersionId() {
          return activeVersionId.value;
        },
        set activeVersionId(next) {
          activeVersionId.value = next;
        },
        get references() {
          return references.value;
        },
        set references(next) {
          references.value = next;
        },
      });
      return;
    }
    buckets.edit(sessionId, mutate);
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
    applyToSession(sessionId, (state) => {
      if (agentName) {
        let target =
          state.versions.find((item) => item.id === state.activeVersionId) ?? null;
        if (!target) {
          const created: TaskListVersion = {
            id: nextTaskId(),
            version: 1,
            items: [],
            createdAt: Date.now(),
          };
          state.versions.push(created);
          state.activeVersionId = created.id;
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
      const existing = state.versions.find((item) => item.version === version);
      if (existing) {
        existing.items = items;
        state.activeVersionId = existing.id;
        return;
      }
      const created: TaskListVersion = {
        id: nextTaskId(),
        version,
        items,
        createdAt: Date.now(),
      };
      state.versions.push(created);
      state.activeVersionId = created.id;
    });
  }

  /** 去重键：网页按归一化地址（忽略 hash / 尾斜杠 / 跟踪参数），文件按原路径 */
  function referenceKey(url: string): string {
    return /^https?:/i.test(url) ? siteKey(url) : url;
  }

  function addReference(sessionId: string, reference: ReferenceItem) {
    const key = referenceKey(reference.url);
    applyToSession(sessionId, (state) => {
      if (state.references.some((item) => referenceKey(item.url) === key)) {
        return;
      }
      state.references.push({ ...reference, id: reference.id || nextRefId() });
    });
  }

  function clear() {
    buckets.reset();
    versions.value = [];
    activeVersionId.value = "";
    references.value = [];
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
