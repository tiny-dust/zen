import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  XCircle,
} from "@lucide/vue";
import { defineStore } from "pinia";
import type { Component } from "vue";
import { computed, ref } from "vue";

import type { AgentNodeState, AgentStreamEvent, SubAgentStatus } from "@zen/shared";

import { createSessionBuckets } from "@/stores/session-buckets";
import { i18n } from "@/locales";

/** UI 侧 Agent 节点（与 shared AgentNodeState 对齐） */
export type AgentNode = AgentNodeState;

/** 子 Agent 状态展示元信息：图标、文案、颜色（AgentsPanel / AgentsSection 共用） */
export const SUB_AGENT_STATUS_META: Record<
  SubAgentStatus,
  { label: string; icon: Component; cls: string }
> = {
  queued: {
    get label() {
      return i18n.global.t("app.agents.status.queued");
    },
    icon: CircleDashed,
    cls: "text-[var(--color-mut)]",
  },
  waiting_deps: {
    get label() {
      return i18n.global.t("app.agents.status.waitingDeps");
    },
    icon: Clock3,
    cls: "text-[var(--color-dim)]",
  },
  waiting_user: {
    get label() {
      return i18n.global.t("app.agents.status.waitingUser");
    },
    icon: Clock3,
    cls: "text-[var(--color-accent)]",
  },
  running: {
    get label() {
      return i18n.global.t("app.agents.status.running");
    },
    icon: Loader2,
    cls: "text-[var(--color-accent)]",
  },
  done: {
    get label() {
      return i18n.global.t("app.agents.status.done");
    },
    icon: CheckCircle2,
    cls: "text-[var(--color-ok,#3d9a6a)]",
  },
  error: {
    get label() {
      return i18n.global.t("app.agents.status.error");
    },
    icon: XCircle,
    cls: "text-[var(--color-err,#c45c5c)]",
  },
  cancelled: {
    get label() {
      return i18n.global.t("app.agents.status.cancelled");
    },
    icon: XCircle,
    cls: "text-[var(--color-dim)]",
  },
};

export const useAgentsStore = defineStore("agents", () => {
  const nodes = ref<AgentNode[]>([]);
  const limit = ref(2);
  const running = ref(0);
  const selectedId = ref("");

  /** 单个会话的 Agent 面板状态（分桶快照） */
  interface AgentsBucketState {
    nodes: AgentNode[];
    selectedId: string;
    limit: number;
    running: number;
  }

  const buckets = createSessionBuckets<AgentsBucketState>({
    initial: () => ({ nodes: [], selectedId: "", limit: 2, running: 0 }),
    capture: () => ({
      nodes: nodes.value,
      selectedId: selectedId.value,
      limit: limit.value,
      running: running.value,
    }),
    restore: (state) => {
      nodes.value = state.nodes;
      selectedId.value = state.selectedId;
      limit.value = state.limit;
      running.value = state.running;
    },
  });
  const sessionId = computed(() => buckets.activeKey);

  const selected = computed(
    () => nodes.value.find((item) => item.id === selectedId.value) ?? null,
  );

  const root = computed<AgentNode | null>(() => {
    if (!sessionId.value) {
      return null;
    }
    const active = nodes.value.some(
      (n) =>
        n.status === "running" ||
        n.status === "queued" ||
        n.status === "waiting_user" ||
        n.status === "waiting_deps",
    );
    return {
      id: `main:${sessionId.value}`,
      sessionId: sessionId.value,
      parentId: null,
      name: i18n.global.t("app.agents.mainAgent"),
      task: i18n.global.t("app.agents.mainTask"),
      status: (active ? "running" : "done") as SubAgentStatus,
      dependsOn: [],
      attempts: 1,
      maxAttempts: 1,
      log: [],
      busyResource: null,
      waitingUser: false,
    };
  });

  /** 切换会话：旧会话 Agent 树入桶，目标会话恢复自己的树 */
  function ensureSession(id: string) {
    buckets.switchTo(id);
  }

  /**
   * 事件落点：事件属于当前查看的会话才直接改 refs；
   * 后台会话的事件写进其桶（切回时恢复），绝不切换当前视图。
   */
  function applyToSession(id: string, mutate: (state: AgentsBucketState) => void) {
    if (id === buckets.activeKey) {
      mutate({
        get nodes() {
          return nodes.value;
        },
        set nodes(next) {
          nodes.value = next;
        },
        get selectedId() {
          return selectedId.value;
        },
        set selectedId(next) {
          selectedId.value = next;
        },
        get limit() {
          return limit.value;
        },
        set limit(next) {
          limit.value = next;
        },
        get running() {
          return running.value;
        },
        set running(next) {
          running.value = next;
        },
      });
      return;
    }
    buckets.edit(id, mutate);
  }

  function applySnapshot(payload: {
    sessionId: string;
    agents: AgentNodeState[];
    concurrency: { limit: number; running: number };
  }) {
    applyToSession(payload.sessionId, (state) => {
      state.nodes = payload.agents.map((item) => ({
        ...item,
        log: [...item.log],
        transcript: item.transcript?.map((entry) => ({ ...entry })),
      }));
      state.limit = payload.concurrency.limit;
      state.running = payload.concurrency.running;
      if (state.selectedId && !state.nodes.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.nodes[0]?.id ?? "";
      }
    });
  }

  function applyStatus(payload: {
    sessionId: string;
    agent: AgentNodeState;
    concurrency: { limit: number; running: number };
  }) {
    applyToSession(payload.sessionId, (state) => {
      const next = {
        ...payload.agent,
        log: [...payload.agent.log],
        transcript: payload.agent.transcript?.map((entry) => ({ ...entry })),
      };
      const index = state.nodes.findIndex((item) => item.id === next.id);
      if (index >= 0) {
        state.nodes.splice(index, 1, next);
      } else {
        state.nodes.push(next);
      }
      state.limit = payload.concurrency.limit;
      state.running = payload.concurrency.running;
    });
  }

  function select(id: string) {
    selectedId.value = id;
  }

  /** 手动重试失败/取消的子 Agent；结果由调用方展示 */
  async function retry(node: AgentNode): Promise<{ ok: boolean; error?: string }> {
    const zen = window.zen;
    if (!zen) {
      return { ok: false, error: i18n.global.t("app.agents.desktopBridgeUnavailable") };
    }
    return zen.agent.retrySubAgent(node.sessionId, node.id);
  }

  function clear() {
    buckets.reset();
    nodes.value = [];
    selectedId.value = "";
    running.value = 0;
  }

  function handleStreamEvent(event: AgentStreamEvent) {
    if (event.type === "agent_tree") {
      applySnapshot(event);
      return;
    }
    if (event.type === "agent_status") {
      // 只更新悬浮信息卡列表；右栏消息面板由用户点击子 Agent 打开
      applyStatus(event);
    }
  }

  return {
    sessionId,
    nodes,
    limit,
    running,
    selectedId,
    selected,
    root,
    ensureSession,
    applySnapshot,
    applyStatus,
    handleStreamEvent,
    select,
    retry,
    clear,
  };
});
