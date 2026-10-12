// 浏览器面板按工作区分桶：URL / 新标签页 / 提示 / 历史随工作区恢复，
// 历史按工作区持久化（localStorage 分 key），旧版全局历史作为迁移种子。
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useBrowserStore } from "@/stores/browser";
import { LEGACY_HISTORY_KEY } from "@/stores/browser-history";

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe("browser bindWorkspaceScope 按工作区分桶", () => {
  it("切走再切回恢复地址栏 / 新标签页 / 提示", () => {
    const store = useBrowserStore();
    store.bindWorkspaceScope("s1");
    store.urlInput = "https://a.com/docs";
    store.showHome = false;
    store.panelNote = "已打开";

    store.bindWorkspaceScope("s2");
    expect(store.urlInput).toBe("");
    expect(store.showHome).toBe(true);
    expect(store.panelNote).toBe("");

    store.urlInput = "https://b.com";
    store.bindWorkspaceScope("s1");
    expect(store.urlInput).toBe("https://a.com/docs");
    expect(store.showHome).toBe(false);
    expect(store.panelNote).toBe("已打开");
  });

  it("历史按工作区恢复：工作区自己的 key 优先，无数据回落旧版全局历史", () => {
    localStorage.setItem(
      "zen.browser.history:s1",
      JSON.stringify([{ url: "https://own.com", title: "自己的", visitedAt: 2 }]),
    );
    localStorage.setItem(
      LEGACY_HISTORY_KEY,
      JSON.stringify([{ url: "https://legacy.com", title: "旧全局", visitedAt: 1 }]),
    );

    const store = useBrowserStore();
    store.bindWorkspaceScope("s1");
    expect(store.history.map((item) => item.url)).toEqual(["https://own.com"]);

    // 无自己历史的工作区：回落旧版全局历史（迁移种子）
    store.bindWorkspaceScope("s2");
    expect(store.history.map((item) => item.url)).toEqual(["https://legacy.com"]);
  });

  it("历史变更按当前工作区 key 落盘", () => {
    const store = useBrowserStore();
    store.bindWorkspaceScope("s1");
    store.history = [{ url: "https://a.com", title: "A", visitedAt: 1 }];
    store.removeHistory("https://a.com");
    expect(store.history).toHaveLength(0);
    expect(localStorage.getItem("zen.browser.history:s1")).toBe("[]");
  });

  it("浏览器面板未打开时切换不触发视图对齐（无 window.zen 也不抛错）", () => {
    const store = useBrowserStore();
    expect(() => store.bindWorkspaceScope("s1")).not.toThrow();
    expect(() => store.bindWorkspaceScope("s2")).not.toThrow();
  });
});
