import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { AgentStreamEvent, ToolCallState, ToolProgressEvent } from "@zen/shared";

import { createSessionBuckets } from "@/stores/session-buckets";
import { i18n } from "@/locales";

export type AgentProcessStatus = ToolCallState | "running";

/** Agent runTerminal 调起的一次终端进程（悬浮信息卡「进程」节） */
export interface AgentProcess {
  id: string;
  sessionId: string;
  command: string;
  status: AgentProcessStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  output?: string;
  error?: string;
}

export const PROCESS_STATUS_META: Record<
  AgentProcessStatus,
  { label: string; cls: string }
> = {
  "input-streaming": {
    get label() {
      return i18n.global.t("app.processes.status.preparing");
    },
    cls: "text-[var(--color-mut)]",
  },
  "awaiting-approval": {
    get label() {
      return i18n.global.t("app.processes.status.awaitingApproval");
    },
    cls: "text-[var(--color-mut)]",
  },
  running: {
    get label() {
      return i18n.global.t("app.processes.status.running");
    },
    cls: "text-[var(--color-accent)]",
  },
  ok: {
    get label() {
      return i18n.global.t("app.processes.status.ok");
    },
    cls: "text-[var(--color-ok,#3d9a6a)]",
  },
  error: {
    get label() {
      return i18n.global.t("app.processes.status.error");
    },
    cls: "text-[var(--color-err,#c45c5c)]",
  },
  denied: {
    get label() {
      return i18n.global.t("app.processes.status.denied");
    },
    cls: "text-[var(--color-dim)]",
  },
  cancelled: {
    get label() {
      return i18n.global.t("app.processes.status.cancelled");
    },
    cls: "text-[var(--color-dim)]",
  },
  interrupted: {
    get label() {
      return i18n.global.t("app.processes.status.interrupted");
    },
    cls: "text-[var(--color-dim)]",
  },
};

function commandOf(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return "";
  }
  const value = (args as Record<string, unknown>).command;
  return typeof value === "string" ? value.trim() : "";
}

/** 常驻终端服务命令特征：dev server / watch / serve / 后台服务等（悬浮面板「进程」只收这些） */
const PERSISTENT_COMMAND_RE =
  /(^|[\s;&|])(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|serve|start|watch|debug)(\s|$)|(^|[\s;&|])(vite|webpack|webpack-dev-server|next|nuxt|nodemon|vite-node|tsx\s+watch|parcel|rspack|astro|gatsby|eleventy|11ty|live-server|http-server|serve|caddy|nginx|docker(\s+compose)?\s+up|docker-compose\s+up|kubectl\s+port-forward|rails\s+s|puma|flask\s+run|uvicorn|gunicorn|air|cargo\s+watch|watchexec|watchman|systemctl|tail\s+-f|less\s+\+F|python(\d(\.\d+)?)?\s+-m\s+http\.server|php\s+-S|ruby\s+-run\s+-ehttpd|busybox\s+httpd)(\s|$)|--watch\b|-w\b\s*$|\bwatch\s+/;

/**
 * 是否是需要持续运行的终端服务（dev server / watch / 常驻进程）。
 * 一次性命令（ls / cat / git status 等）不进悬浮面板「进程」节。
 */
export function isPersistentCommand(command: string): boolean {
  const text = command.trim();
  if (!text) {
    return false;
  }
  return PERSISTENT_COMMAND_RE.test(text);
}

function exitCodeOf(output: unknown): number | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const code = (output as Record<string, unknown>).exitCode;
  return typeof code === "number" ? code : undefined;
}

function outputTextOf(output: unknown): string | undefined {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const text = (output as Record<string, unknown>).output;
  return typeof text === "string" ? text : undefined;
}

/** 单个会话的进程面板状态（分桶快照） */
interface ProcessesBucketState {
  items: AgentProcess[];
  expandedId: string;
}

/**
 * 会话信息卡「进程」：收集 Agent 调起的 runTerminal。
 * 按 sessionId 分桶隔离；切会话时暂存，切回时恢复（不再清空丢数据）。
 */
export const useAgentProcessesStore = defineStore("agentProcesses", () => {
  const items = ref<AgentProcess[]>([]);
  const expandedId = ref("");

  const buckets = createSessionBuckets<ProcessesBucketState>({
    initial: () => ({ items: [], expandedId: "" }),
    capture: () => ({ items: items.value, expandedId: expandedId.value }),
    restore: (state) => {
      items.value = state.items;
      expandedId.value = state.expandedId;
    },
  });
  const ownerSessionId = computed(() => buckets.activeKey);

  const runningCount = computed(
    () => items.value.filter((item) => item.status === "running").length,
  );

  /** 切换会话：旧会话进程清单入桶，目标会话恢复自己的清单 */
  function ensureSession(sessionId: string) {
    buckets.switchTo(sessionId);
  }

  /**
   * 事件落点：事件属于当前查看的会话才直接改 refs；
   * 后台会话的事件写进其桶（切回时恢复），绝不切换当前视图。
   */
  function applyToSession(sessionId: string, mutate: (state: ProcessesBucketState) => void) {
    if (sessionId === buckets.activeKey) {
      mutate({
        get items() {
          return items.value;
        },
        set items(next) {
          items.value = next;
        },
        get expandedId() {
          return expandedId.value;
        },
        set expandedId(next) {
          expandedId.value = next;
        },
      });
      return;
    }
    buckets.edit(sessionId, mutate);
  }

  function noteToolStart(sessionId: string, toolCallId: string, toolName: string, args: unknown) {
    if (toolName !== "runTerminal") {
      return;
    }
    // 只收集需要持续运行的终端服务，避免一次性命令刷屏
    if (!isPersistentCommand(commandOf(args))) {
      return;
    }
    applyToSession(sessionId, (state) => {
      const existing = state.items.find((item) => item.id === toolCallId);
      if (existing) {
        existing.status = "running";
        existing.endedAt = undefined;
        existing.summary = undefined;
        existing.output = undefined;
        existing.error = undefined;
        return;
      }
      state.items.push({
        id: toolCallId,
        sessionId,
        command: commandOf(args),
        status: "running",
        startedAt: Date.now(),
      });
    });
  }

  function noteToolEnd(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    payload: {
      ok: boolean;
      state?: ToolCallState;
      summary: string;
      output?: unknown;
    },
  ) {
    if (toolName !== "runTerminal") {
      return;
    }
    applyToSession(sessionId, (state) => {
      const item = state.items.find((entry) => entry.id === toolCallId);
      if (!item) {
        return;
      }
      const exitCode = exitCodeOf(payload.output);
      item.status = payload.state ?? (payload.ok ? "ok" : "error");
      item.endedAt = Date.now();
      item.summary = exitCode != null ? `${payload.summary} · exit ${exitCode}` : payload.summary;
      item.output = outputTextOf(payload.output);
      item.error = payload.ok ? undefined : payload.summary;
    });
  }

  /** 运行中输出尾部：tool_progress 增量刷新（持续运行命令的实时输出，仅保留发送侧限量尾部） */
  function noteToolProgress(sessionId: string, event: ToolProgressEvent) {
    if (event.toolName !== "runTerminal" || event.outputTail == null) {
      return;
    }
    applyToSession(sessionId, (state) => {
      const item = state.items.find((entry) => entry.id === event.toolCallId);
      if (!item || item.status !== "running") {
        return;
      }
      item.output = event.outputTail;
    });
  }

  function toggle(id: string) {
    expandedId.value = expandedId.value === id ? "" : id;
  }

  function clear() {
    buckets.reset();
    items.value = [];
    expandedId.value = "";
  }

  /** 流事件入口：chat 事件网关转发 runTerminal 生命周期 */
  function handleStreamEvent(event: AgentStreamEvent) {
    if (event.type === "tool_start") {
      noteToolStart(event.sessionId, event.toolCallId, event.toolName, event.args);
      return;
    }
    if (event.type === "tool_progress") {
      noteToolProgress(event.sessionId, event.event);
      return;
    }
    if (event.type === "tool_end") {
      noteToolEnd(event.sessionId, event.toolCallId, event.toolName, {
        ok: event.ok,
        state: event.state,
        summary: event.summary,
        output: event.output,
      });
    }
  }

  return {
    ownerSessionId,
    items,
    expandedId,
    runningCount,
    ensureSession,
    noteToolStart,
    noteToolEnd,
    noteToolProgress,
    toggle,
    clear,
    handleStreamEvent,
  };
});
