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

/** UI 侧 Agent 节点（与 shared AgentNodeState 对齐） */
export type AgentNode = AgentNodeState;

/** 子 Agent 状态展示元信息：图标、文案、颜色（AgentsPanel / AgentsSection 共用） */
export const SUB_AGENT_STATUS_META: Record<
  SubAgentStatus,
  { label: string; icon: Component; cls: string }
> = {
  queued: { label: "排队", icon: CircleDashed, cls: "text-[var(--color-mut)]" },
  waiting_deps: { label: "等待依赖", icon: Clock3, cls: "text-[var(--color-dim)]" },
  waiting_user: { label: "等待回答", icon: Clock3, cls: "text-[var(--color-accent)]" },
  running: { label: "运行中", icon: Loader2, cls: "text-[var(--color-accent)]" },
  done: { label: "完成", icon: CheckCircle2, cls: "text-[var(--color-ok,#3d9a6a)]" },
  error: { label: "失败", icon: XCircle, cls: "text-[var(--color-err,#c45c5c)]" },
  cancelled: { label: "已取消", icon: XCircle, cls: "text-[var(--color-dim)]" },
};

export const useAgentsStore = defineStore("agents", () => {
  const sessionId = ref("");
  const nodes = ref<AgentNode[]>([]);
  const limit = ref(2);
  const running = ref(0);
  const selectedId = ref("");

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
      name: "主 Agent",
      task: "当前会话主任务",
      status: (active ? "running" : "done") as SubAgentStatus,
      dependsOn: [],
      attempts: 1,
      maxAttempts: 1,
      log: [],
      busyResource: null,
      waitingUser: false,
    };
  });

  function ensureSession(id: string) {
    if (sessionId.value && sessionId.value !== id) {
      nodes.value = [];
      selectedId.value = "";
    }
    sessionId.value = id;
  }

  function applySnapshot(payload: {
    sessionId: string;
    agents: AgentNodeState[];
    concurrency: { limit: number; running: number };
  }) {
    ensureSession(payload.sessionId);
    nodes.value = payload.agents.map((item) => ({
      ...item,
      log: [...item.log],
      transcript: item.transcript?.map((entry) => ({ ...entry })),
    }));
    limit.value = payload.concurrency.limit;
    running.value = payload.concurrency.running;
    if (selectedId.value && !nodes.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = nodes.value[0]?.id ?? "";
    }
  }

  function applyStatus(payload: {
    sessionId: string;
    agent: AgentNodeState;
    concurrency: { limit: number; running: number };
  }) {
    ensureSession(payload.sessionId);
    const next = {
      ...payload.agent,
      log: [...payload.agent.log],
      transcript: payload.agent.transcript?.map((entry) => ({ ...entry })),
    };
    const index = nodes.value.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      nodes.value.splice(index, 1, next);
    } else {
      nodes.value.push(next);
    }
    limit.value = payload.concurrency.limit;
    running.value = payload.concurrency.running;
  }

  function select(id: string) {
    selectedId.value = id;
  }

  function clear() {
    sessionId.value = "";
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
    clear,
  };
});
