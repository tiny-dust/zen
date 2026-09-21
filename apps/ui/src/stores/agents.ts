import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { AgentNodeState, AgentStreamEvent, SubAgentStatus } from "@zen/shared";

import { useRightPanelStore } from "@/stores/right-panel";

/** UI 侧 Agent 节点（与 shared AgentNodeState 对齐） */
export type AgentNode = AgentNodeState;

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
    const active = nodes.value.some((n) => n.status === "running" || n.status === "queued");
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
    nodes.value = payload.agents.map((item) => ({ ...item, log: [...item.log] }));
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
    const next = { ...payload.agent, log: [...payload.agent.log] };
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
      applyStatus(event);
      if (event.agent.status === "running" || event.agent.status === "queued") {
        useRightPanelStore().ensureTab("agents");
      }
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
