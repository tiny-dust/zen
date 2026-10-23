import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { AgentServiceInfo } from "@zen/shared";

import { i18n } from "@/locales";

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
  let ticker: ReturnType<typeof setInterval> | null = null;
  let unbind: (() => void) | null = null;

  const count = computed(() => items.value.length);

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

  function apply(list: AgentServiceInfo[]) {
    items.value = list;
    // 服务自行退出（主进程清扫移除）时收起其详情
    if (expandedId.value && !list.some((item) => item.id === expandedId.value)) {
      expandedId.value = "";
    }
    if (list.length) {
      startTicker();
    }
    stopTickerIfEmpty();
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
    count,
    bindEvents,
    refresh,
    kill,
    toggle,
    focus,
    durationLabel,
  };
});
