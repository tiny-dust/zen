import { defineStore } from "pinia";
import { ref } from "vue";

import type { ErrorReportAnalysis, ErrorReportKind, ErrorReportRecord, ErrorReportSource } from "@zen/shared";
import { useChatStore } from "@/stores/chat";

/** 修复提示词里的来源/类型中文标签（发给 Agent 的消息，非界面文案） */
const SOURCE_LABELS: Record<ErrorReportSource, string> = {
  main: "主进程",
  renderer: "渲染层",
};

const KIND_LABELS: Record<ErrorReportKind, string> = {
  uncaught: "主进程未捕获异常",
  unhandled: "未处理的 Promise 拒绝",
  "window-error": "渲染层全局错误",
  vue: "Vue 组件错误",
  "resource-error": "资源加载失败",
  "render-process-gone": "渲染进程崩溃",
};

/**
 * 一键修复的提示词（纯函数）：异常报告关键字段 + 初步分析 + diagnosing-bugs
 * 修复指令。作为新会话的首条用户消息发给 Agent。
 */
export function buildFixPrompt(record: ErrorReportRecord, analysis: ErrorReportAnalysis | null): string {
  const lines = [
    "这是 Zen 软件运行时收集到的软件相关异常报告。请按 diagnosing-bugs 思路定位本仓库内根因并最小修复，改完跑相关测试与 typecheck 验证。",
    "",
    `- 来源：${SOURCE_LABELS[record.source] ?? record.source}`,
    `- 类型：${KIND_LABELS[record.kind] ?? record.kind}`,
    `- 消息：${record.message}`,
    `- 出现次数：${record.count}（最近发生：${new Date(record.lastSeenAt).toISOString()}）`,
  ];
  if (record.stack) {
    lines.push("", "堆栈：", "```", record.stack, "```");
  }
  if (analysis) {
    lines.push("", `- 初步分析：${analysis.reason}（置信度：${analysis.confidence === "high" ? "高" : "低"}）`);
  }
  return lines.join("\n");
}

/**
 * 右栏异常中心：主进程 + 渲染层运行时报错的列表 / 分析 / 一键修复。
 * 数据源 window.zen.errors（errors:* IPC），变更经 errors:changed 广播重新拉取。
 */
export const useErrorsStore = defineStore("errors", () => {
  /** 异常列表（lastSeenAt 降序，最近发生的在前） */
  const reports = ref<ErrorReportRecord[]>([]);
  /** id → 本地启发式分析结果 */
  const analysisMap = ref<Record<string, ErrorReportAnalysis>>({});
  const loaded = ref(false);
  /** 正在分析的记录 id（按钮 loading 态） */
  const analyzing = ref<Record<string, boolean>>({});

  /** errors:changed 订阅；应用生命周期内只绑一次（面板反复挂载不重复订阅） */
  let unlisten: (() => void) | null = null;

  async function refresh() {
    const zen = window.zen?.errors;
    if (!zen) {
      return;
    }
    try {
      const list = await zen.list();
      reports.value = [...list].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    } catch {
      // IPC 失败保留上次快照
    }
    loaded.value = true;
  }

  /** 面板挂载时调用：订阅变更广播（无载荷，收到重新 list），幂等 */
  function init() {
    const zen = window.zen?.errors;
    if (unlisten || !zen) {
      return;
    }
    try {
      unlisten = zen.onChanged(() => {
        void refresh();
      });
    } catch {
      // 订阅失败静默：仍可手动刷新
    }
  }

  /** 单条分析：结果存入 analysisMap，不可判定（null）不落 map */
  async function analyze(id: string): Promise<ErrorReportAnalysis | null> {
    const zen = window.zen?.errors;
    if (!zen) {
      return null;
    }
    analyzing.value[id] = true;
    try {
      const analysis = await zen.analyze(id);
      if (analysis) {
        analysisMap.value[id] = analysis;
      } else {
        delete analysisMap.value[id];
      }
      return analysis;
    } catch {
      return null;
    } finally {
      analyzing.value[id] = false;
    }
  }

  async function clearAll() {
    try {
      await window.zen?.errors?.clear();
      analysisMap.value = {};
      await refresh();
    } catch {
      // 静默
    }
  }

  async function removeOne(id: string) {
    try {
      await window.zen?.errors?.clear([id]);
      delete analysisMap.value[id];
      await refresh();
    } catch {
      // 静默
    }
  }

  /**
   * 一键修复：走 chat store 现有入口（newTask 在当前工作区新建会话 + send 以
   * overrideText 发出，不消费 composer 状态），提示词为该会话首条用户消息。
   */
  async function startFix(record: ErrorReportRecord) {
    const chat = useChatStore();
    const prompt = buildFixPrompt(record, analysisMap.value[record.id] ?? null);
    await chat.newTask();
    await chat.send(prompt);
  }

  return {
    reports,
    analysisMap,
    loaded,
    analyzing,
    refresh,
    init,
    analyze,
    clearAll,
    removeOne,
    startFix,
  };
});
