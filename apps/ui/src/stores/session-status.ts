import { defineStore } from "pinia";
import { computed, ref } from "vue";

/** 会话运行态：侧栏卡片据此展示「进行中 / 需要操作 / 已完成」 */
export type SessionRuntimeStatus = "idle" | "running" | "needs_action" | "done" | "error";

const UNSEEN_RESULTS_KEY = "zen.sessionStatus.unseenResults";

function loadUnseenResults(): Record<string, "done" | "error"> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(UNSEEN_RESULTS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, "done" | "error"] =>
          entry[1] === "done" || entry[1] === "error",
      ),
    );
  } catch {
    return {};
  }
}

export const useSessionStatusStore = defineStore("session-status", () => {
  const initialUnseen = loadUnseenResults();
  const byId = ref<Record<string, SessionRuntimeStatus>>(initialUnseen);
  /** 有「已完成 / 失败」结果但还没被重新打开过的会话（侧栏小圆点，打开后清除） */
  const unseenResults = ref<Record<string, true>>(
    Object.fromEntries(Object.keys(initialUnseen).map((id) => [id, true])),
  );
  const revision = ref(0);

  function persistUnseenResults() {
    const values = Object.fromEntries(
      Object.keys(unseenResults.value)
        .filter((id) => byId.value[id] === "done" || byId.value[id] === "error")
        .map((id) => [id, byId.value[id]]),
    );
    try {
      localStorage.setItem(UNSEEN_RESULTS_KEY, JSON.stringify(values));
    } catch {
      // 浏览器存储不可用时仅保持当前窗口内的未读状态。
    }
  }

  const snapshot = computed(() => {
    revision.value;
    return byId.value;
  });

  const get = (id: string): SessionRuntimeStatus => byId.value[id] ?? "idle";

  function set(id: string, status: SessionRuntimeStatus) {
    if (!id) {
      return;
    }
    byId.value = { ...byId.value, [id]: status };
    if (status === "done" || status === "error") {
      unseenResults.value = { ...unseenResults.value, [id]: true };
    } else if (id in unseenResults.value) {
      // 回到运行/等待态说明结果已过时，撤销未读标记
      const next = { ...unseenResults.value };
      delete next[id];
      unseenResults.value = next;
    }
    revision.value += 1;
    persistUnseenResults();
  }

  /** 用户重新打开会话：清除结果未读标记 */
  function markSeen(id: string) {
    if (!(id in unseenResults.value)) {
      return;
    }
    const next = { ...unseenResults.value };
    delete next[id];
    unseenResults.value = next;
    revision.value += 1;
    persistUnseenResults();
  }

  const hasUnseenResult = (id: string): boolean => !!unseenResults.value[id];

  function clear(id: string) {
    if (!(id in byId.value) && !(id in unseenResults.value)) {
      return;
    }
    const next = { ...byId.value };
    delete next[id];
    byId.value = next;
    const nextUnseen = { ...unseenResults.value };
    delete nextUnseen[id];
    unseenResults.value = nextUnseen;
    revision.value += 1;
    persistUnseenResults();
  }

  return {
    byId,
    snapshot,
    get,
    set,
    markSeen,
    hasUnseenResult,
    clear,
  };
});
