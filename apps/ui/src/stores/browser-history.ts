import type { Ref } from "vue";
import { computed, ref } from "vue";

import type { BrowserHistoryItem } from "@zen/shared";

const HISTORY_KEY = "zen.browser.history";
const HISTORY_LIMIT = 50;

function loadHistory(): BrowserHistoryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(
        (item): item is BrowserHistoryItem =>
          Boolean(item) &&
          typeof (item as BrowserHistoryItem).url === "string" &&
          Boolean((item as BrowserHistoryItem).url),
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(items: BrowserHistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    // quota / private mode
  }
}

/** 浏览历史子域的依赖：联想要读当前输入，清空要提示 */
export interface BrowserHistoryOptions {
  urlInput: Ref<string>;
  panelNote: Ref<string>;
}

/** 浏览历史：localStorage 持久化 + 地址栏联想建议 */
export function createBrowserHistory(options: BrowserHistoryOptions) {
  const { urlInput, panelNote } = options;
  const history = ref<BrowserHistoryItem[]>(loadHistory());

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
    const next = [
      { url, title: title || url, visitedAt: Date.now() },
      ...history.value.filter((item) => item.url !== url),
    ].slice(0, HISTORY_LIMIT);
    history.value = next;
    saveHistory(next);
  }

  function removeHistory(url: string) {
    history.value = history.value.filter((item) => item.url !== url);
    saveHistory(history.value);
  }

  function clearHistory() {
    history.value = [];
    saveHistory([]);
    panelNote.value = "已清空浏览历史";
  }

  return { history, suggestions, pushHistory, removeHistory, clearHistory };
}

export type BrowserHistory = ReturnType<typeof createBrowserHistory>;
