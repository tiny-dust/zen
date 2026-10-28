import type { Ref } from "vue";
import { computed } from "vue";

import type { BrowserHistoryItem } from "@zen/shared";

import { i18n } from "@/locales";
import { siteKey } from "@/lib/site-url";

const HISTORY_LIMIT = 50;
/** 旧版全局历史 key：分会话持久化的迁移种子（各会话首次无自己历史时回落到它） */
export const LEGACY_HISTORY_KEY = "zen.browser.history";

function historyKeyOf(sessionId: string): string {
  return `zen.browser.history:${sessionId}`;
}

/** 同一页面只保留最近一次：按归一化地址去重（忽略 hash / 尾斜杠 / 跟踪参数） */
function dedupeHistory(items: BrowserHistoryItem[]): BrowserHistoryItem[] {
  const seen = new Set<string>();
  const out: BrowserHistoryItem[] = [];
  for (const item of items) {
    const key = siteKey(item.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseHistory(raw: string | null): BrowserHistoryItem[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) {
      return [];
    }
    return dedupeHistory(
      list.filter(
        (item): item is BrowserHistoryItem =>
          Boolean(item) &&
          typeof (item as BrowserHistoryItem).url === "string" &&
          Boolean((item as BrowserHistoryItem).url),
      ),
    ).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** 读取某个 key 的历史（坏 JSON / 非数组 / 脏条目安全回落空表） */
export function loadHistory(key: string): BrowserHistoryItem[] {
  return parseHistory(localStorage.getItem(key));
}

export function saveHistory(key: string, items: BrowserHistoryItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    // quota / private mode
  }
}

/**
 * 某个 chat 会话的浏览历史：优先读会话自己的持久化 key，
 * 没有则回落旧版全局历史（迁移种子），保证升级后旧数据仍可见。
 */
export function loadSessionHistory(sessionId: string): BrowserHistoryItem[] {
  const own = loadHistory(historyKeyOf(sessionId));
  if (own.length) {
    return own;
  }
  return loadHistory(LEGACY_HISTORY_KEY);
}

/** 浏览历史子域的依赖：联想要读当前输入，清空要提示 */
export interface BrowserHistoryOptions {
  urlInput: Ref<string>;
  panelNote: Ref<string>;
  /** 历史列表（按 chat 会话分桶，由 browser store 持有并随会话切换恢复） */
  history: Ref<BrowserHistoryItem[]>;
  /** 持久化回调（browser store 按当前会话 key 落盘） */
  persist: (items: BrowserHistoryItem[]) => void;
}

/** 浏览历史：地址栏联想建议 + 增删清（列表本体由调用方持有，随会话分桶） */
export function createBrowserHistory(options: BrowserHistoryOptions) {
  const { urlInput, panelNote, history, persist } = options;

  const suggestions = computed(() => {
    const q = urlInput.value.trim().toLowerCase();
    if (!q) {
      return history.value.slice(0, 8);
    }
    return history.value
      .filter(
        (item) =>
          item.url.toLowerCase().includes(q) || (item.title || "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  });

  function pushHistory(url: string, title: string) {
    if (!url || url === "about:blank") {
      return;
    }
    // 同一页面（忽略 hash / 尾斜杠 / 跟踪参数）只留最新一条，历史里不堆重复地址
    const key = siteKey(url);
    const next = dedupeHistory([
      { url, title: title || url, visitedAt: Date.now() },
      ...history.value.filter((item) => siteKey(item.url) !== key),
    ]).slice(0, HISTORY_LIMIT);
    history.value = next;
    persist(next);
  }

  function removeHistory(url: string) {
    // 删除按同一去重口径：把该页面的所有写法一起清掉
    const key = siteKey(url);
    const next = history.value.filter((item) => siteKey(item.url) !== key);
    history.value = next;
    persist(next);
  }

  function clearHistory() {
    history.value = [];
    persist([]);
    panelNote.value = i18n.global.t("app.browserHistory.cleared");
  }

  return { history, suggestions, pushHistory, removeHistory, clearHistory };
}

export type BrowserHistory = ReturnType<typeof createBrowserHistory>;
