import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { AgentServiceInfo, ProcessStat } from "@zen/shared";

import { i18n } from "@/locales";
import { useAgentProcessesStore } from "@/stores/agent-processes";
import { useTerminalStore } from "@/stores/terminal";

/**
 * 右栏「服务」：主进程收集的 runTerminal 长驻进程（dev server / watch 等）。
 * 数据源为主进程推送（services:changed）与主动 list；kill 走 services:kill。
 */
export const useAgentServicesStore = defineStore("agentServices", () => {
  const items = ref<AgentServiceInfo[]>([]);
  const error = ref("");
  const killingIds = ref<Record<string, boolean>>({});
  /** 详情展开：同一时间只展开一个（同「终端服务」节交互） */
  const expandedId = ref("");
  /** 时钟：驱动「已运行 xx」的相对时间刷新 */
  const now = ref(Date.now());
  /** 真实进程指标（按 pid）；采样不到的 pid 不在表里 → UI 显示不可用 */
  const stats = ref<Record<string, ProcessStat>>({});
  let ticker: ReturnType<typeof setInterval> | null = null;
  let statsTicker: ReturnType<typeof setInterval> | null = null;
  let unbind: (() => void) | null = null;

  const count = computed(() => items.value.length);
  /** Agent 执行中、后台服务与手动终端活动统一按父会话归属；只用于侧栏提示。 */
  const terminalStore = useTerminalStore();
  const agentProcesses = useAgentProcessesStore();
  const activeSessionCounts = computed(() => {
    const counts: Record<string, number> = {};
    const add = (sessionId: string, amount = 1) => {
      const id = sessionId.split("::")[0];
      if (id) counts[id] = (counts[id] ?? 0) + amount;
    };
    for (const [id, count] of Object.entries(agentProcesses.runningServiceSessions)) add(id, count);
    for (const item of items.value) add(item.sessionId);
    for (const item of terminalStore.activeActivities) {
      if (item.ownerSessionId) add(item.ownerSessionId);
    }
    return counts;
  });

  function startTicker() {
    if (ticker == null) {
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 10_000);
    }
  }

  function stopTickerIfEmpty() {
    if (ticker != null && !items.value.length) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  /**
   * 采样真实进程指标（CPU / 内存）：只把主进程实际读到的 pid 写进表，
   * 读不到就不写——UI 据此显示「不可用」，不填 0。
   */
  async function refreshStats() {
    if (!window.zen?.services) {
      return;
    }
    const pids = items.value.flatMap((item) => item.pids);
    if (!pids.length) {
      stats.value = {};
      return;
    }
    try {
      const list = await window.zen.services.stats(pids);
      stats.value = Object.fromEntries(list.map((stat) => [String(stat.pid), stat]));
    } catch {
      stats.value = {};
    }
  }

  function startStatsTicker() {
    if (statsTicker != null || !items.value.length) {
      return;
    }
    void refreshStats();
    statsTicker = setInterval(() => void refreshStats(), 5_000);
  }

  function stopStatsTickerIfEmpty() {
    if (statsTicker != null && !items.value.length) {
      clearInterval(statsTicker);
      statsTicker = null;
      stats.value = {};
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) {
      return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    }
    if (bytes >= 1024 ** 2) {
      return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    }
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  }

  /**
   * 服务的进程指标摘要：整组 pid 全部采样到才求和，任一缺失该指标就标不可用
   * （避免用「部分可见」冒充全量）。
   */
  function statLabel(item: AgentServiceInfo): string {
    const { t } = i18n.global;
    const samples = item.pids
      .map((pid) => stats.value[String(pid)])
      .filter((stat): stat is ProcessStat => stat != null);
    if (!samples.length) {
      return t("app.services.statsUnavailable");
    }
    const parts: string[] = [];
    if (samples.every((stat) => stat.cpuPercent != null)) {
      const cpu = samples.reduce((sum, stat) => sum + (stat.cpuPercent ?? 0), 0);
      parts.push(t("app.services.cpuPercent", { value: cpu.toFixed(1) }));
    }
    if (samples.length === item.pids.length && samples.every((stat) => stat.rssBytes != null)) {
      const rss = samples.reduce((sum, stat) => sum + (stat.rssBytes ?? 0), 0);
      parts.push(t("app.services.memoryUsage", { value: formatBytes(rss) }));
    }
    return parts.length ? parts.join(" · ") : t("app.services.statsUnavailable");
  }

  function apply(list: AgentServiceInfo[]) {
    items.value = list;
    // 服务自行退出（主进程清扫移除）时收起其详情
    if (expandedId.value && !list.some((item) => item.id === expandedId.value)) {
      expandedId.value = "";
    }
    if (list.length) {
      startTicker();
      startStatsTicker();
    }
    stopTickerIfEmpty();
    stopStatsTickerIfEmpty();
  }

  function bindEvents() {
    if (unbind || !window.zen?.services) {
      return () => undefined;
    }
    unbind = window.zen.services.onChange((list) => apply(list));
    void refresh();
    return () => undefined;
  }

  async function refresh() {
    if (!window.zen?.services) {
      return;
    }
    try {
      apply(await window.zen.services.list());
      error.value = "";
    } catch {
      // 面板打开瞬间 IPC 失败：保留旧数据，等下次推送
    }
  }

  async function kill(id: string) {
    if (!window.zen?.services) {
      return { ok: false, error: i18n.global.t("app.services.ipcUnavailable") };
    }
    killingIds.value = { ...killingIds.value, [id]: true };
    try {
      const result = await window.zen.services.kill(id);
      if (result.ok) {
        items.value = items.value.filter((item) => item.id !== id);
        if (expandedId.value === id) {
          expandedId.value = "";
        }
        stopTickerIfEmpty();
        stopStatsTickerIfEmpty();
        void refreshStats();
      } else {
        error.value = result.error || i18n.global.t("app.services.killFailed");
      }
      return result;
    } finally {
      const next = { ...killingIds.value };
      delete next[id];
      killingIds.value = next;
    }
  }

  function toggle(id: string) {
    expandedId.value = expandedId.value === id ? "" : id;
  }

  /** 直接聚焦某个服务（信息面板点击条目 → 右栏「服务」定位展开） */
  function focus(id: string) {
    expandedId.value = id;
  }

  /** 「已运行 xx」相对时长标签 */
  function durationLabel(startedAt: number): string {
    const { t } = i18n.global;
    const seconds = Math.max(0, Math.floor((now.value - startedAt) / 1000));
    if (seconds < 60) {
      return t("app.services.durationSeconds", { n: seconds });
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return t("app.services.durationMinutes", { n: minutes });
    }
    const hours = Math.floor(minutes / 60);
    return t("app.services.durationHours", { h: hours, m: minutes % 60 });
  }

  return {
    items,
    error,
    killingIds,
    expandedId,
    now,
    stats,
    count,
    activeSessionCounts,
    bindEvents,
    refresh,
    refreshStats,
    kill,
    toggle,
    focus,
    durationLabel,
    statLabel,
  };
});
