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

  function applyTasksUpdated(sessionId: string, version: number, items: TaskItem[]) {
    ensureSession(sessionId);
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
    syncFromChat,
    ensureSession,
  };
});
