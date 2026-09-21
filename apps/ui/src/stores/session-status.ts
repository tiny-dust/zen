import { defineStore } from "pinia";
import { computed, ref } from "vue";

/** 会话运行态：侧栏卡片据此展示「进行中 / 需要操作 / 已完成」 */
export type SessionRuntimeStatus = "idle" | "running" | "needs_action" | "done" | "error";

export const useSessionStatusStore = defineStore("session-status", () => {
  const byId = ref<Record<string, SessionRuntimeStatus>>({});
  const revision = ref(0);

  const snapshot = computed(() => {
    revision.value;
    return byId.value;
  });

  function get(id: string): SessionRuntimeStatus {
    revision.value;
    return byId.value[id] ?? "idle";
  }

  function set(id: string, status: SessionRuntimeStatus) {
    if (!id) {
      return;
    }
    byId.value = { ...byId.value, [id]: status };
    revision.value += 1;
  }

  function clear(id: string) {
    if (!(id in byId.value)) {
      return;
    }
    const next = { ...byId.value };
    delete next[id];
    byId.value = next;
    revision.value += 1;
  }

  return {
    byId,
    snapshot,
    get,
    set,
    clear,
  };
});
