import { beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";

import { LEGACY_HISTORY_KEY, loadHistory, saveHistory } from "@/stores/browser-history";
import { createBrowserHistory } from "@/stores/browser-history";

const HISTORY_KEY = "zen.browser.history:test";

/** 组装分桶时代的浏览历史子域：history 本体由调用方持有，persist 指定 key 落库 */
function setup() {
  const history = ref(loadHistory(HISTORY_KEY));
  const domain = createBrowserHistory({
    urlInput: ref(""),
    panelNote: ref(""),
    history,
    persist: (items) => saveHistory(HISTORY_KEY, items),
  });
  return { ...domain, history };
}

function seed(items: unknown) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function stored(): Array<{ url: string }> {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
}

beforeEach(() => {
  localStorage.clear();
});

describe("loadHistory / loadSessionHistory 初始加载", () => {
  it("从指定 key 恢复历史", () => {
    seed([{ url: "https://a.com", title: "A", visitedAt: 1 }]);
    const { history } = setup();
    expect(history.value).toHaveLength(1);
    expect(history.value[0]?.url).toBe("https://a.com");
  });

  it("坏 JSON / 非数组 / 脏条目：安全回落", () => {
    localStorage.setItem(HISTORY_KEY, "not-json");
    expect(setup().history.value).toEqual([]);

    seed({ url: "x" });
    expect(setup().history.value).toEqual([]);

    seed([null, 42, { title: "no-url" }, { url: "" }, { url: "https://ok.com", title: "ok", visitedAt: 1 }]);
    const { history } = setup();
    expect(history.value.map((item) => item.url)).toEqual(["https://ok.com"]);
  });

  it("加载超过 50 条只保留前 50", () => {
    seed(
      Array.from({ length: 60 }, (_, i) => ({
        url: `https://site${i}.com`,
        title: `t${i}`,
        visitedAt: i,
      })),
    );
    expect(setup().history.value).toHaveLength(50);
    expect(setup().history.value[49]?.url).toBe("https://site49.com");
  });

  it("会话 key 无数据时回落旧版全局历史（迁移种子）", () => {
    localStorage.setItem(
      LEGACY_HISTORY_KEY,
      JSON.stringify([{ url: "https://legacy.com", title: "旧", visitedAt: 1 }]),
    );
    expect(loadHistory(LEGACY_HISTORY_KEY)).toHaveLength(1);
    // 会话自己的 key 优先：有数据时不再回落
    localStorage.setItem(
      "zen.browser.history:s1",
      JSON.stringify([{ url: "https://own.com", title: "自己", visitedAt: 2 }]),
    );
    // loadSessionHistory 语义在 browser store 测试中覆盖；此处直接验证两个 key 的读取
    expect(loadHistory("zen.browser.history:s1")).toHaveLength(1);
    expect(loadHistory("zen.browser.history:s2")).toEqual([]);
  });
});

describe("pushHistory / removeHistory / clearHistory", () => {
  it("忽略空 url 与 about:blank", () => {
    const { history, pushHistory } = setup();
    pushHistory("", "x");
    pushHistory("about:blank", "blank");
    expect(history.value).toHaveLength(0);
    expect(stored()).toHaveLength(0);
  });

  it("同 url 去重置顶，title 缺省回落 url 并落库", () => {
    const { history, pushHistory } = setup();
    pushHistory("https://a.com", "A");
    pushHistory("https://b.com", "B");
    pushHistory("https://a.com", "A2");
    expect(history.value.map((item) => item.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(history.value[0]?.title).toBe("A2");

    pushHistory("https://c.com", "");
    expect(history.value[0]?.title).toBe("https://c.com");
    expect(stored().map((item) => item.url)).toEqual([
      "https://c.com",
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("持久化上限 50 条", () => {
    const { history, pushHistory } = setup();
    for (let i = 0; i < 55; i += 1) {
      pushHistory(`https://site${i}.com`, `t${i}`);
    }
    expect(history.value).toHaveLength(50);
    expect(stored()).toHaveLength(50);
    // 最新的在最前
    expect(history.value[0]?.url).toBe("https://site54.com");
  });

  it("removeHistory 删除单条并落库", () => {
    const { history, pushHistory, removeHistory } = setup();
    pushHistory("https://a.com", "A");
    pushHistory("https://b.com", "B");
    removeHistory("https://a.com");
    expect(history.value.map((item) => item.url)).toEqual(["https://b.com"]);
    expect(stored().map((item) => item.url)).toEqual(["https://b.com"]);
  });

  it("clearHistory 清空并提示", () => {
    const panelNote = ref("");
    const history = ref(loadHistory(HISTORY_KEY));
    const { pushHistory, clearHistory } = createBrowserHistory({
      urlInput: ref(""),
      panelNote,
      history,
      persist: (items) => saveHistory(HISTORY_KEY, items),
    });
    pushHistory("https://a.com", "A");
    clearHistory();
    expect(history.value).toEqual([]);
    expect(stored()).toEqual([]);
    expect(panelNote.value).toBe("已清空浏览历史");
  });

  it("localStorage 写入失败不抛错", () => {
    const { pushHistory } = setup();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => pushHistory("https://a.com", "A")).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("suggestions 联想", () => {
  it("输入为空展示最近 8 条", () => {
    const { pushHistory, suggestions } = setup();
    for (let i = 0; i < 10; i += 1) {
      pushHistory(`https://site${i}.com`, `t${i}`);
    }
    expect(suggestions.value).toHaveLength(8);
    expect(suggestions.value[0]?.url).toBe("https://site9.com");
  });

  it("按 url / title 过滤（忽略大小写），命中上限 8 条", () => {
    const urlInput = ref("");
    const history = ref(loadHistory(HISTORY_KEY));
    const { pushHistory, suggestions } = createBrowserHistory({
      urlInput,
      panelNote: ref(""),
      history,
      persist: (items) => saveHistory(HISTORY_KEY, items),
    });
    pushHistory("https://GitHub.com/a", "Repo A");
    pushHistory("https://example.com/b", "GITHUB mirror");
    pushHistory("https://other.com/c", "无关");

    urlInput.value = "github";
    // pushHistory 置顶：后 push 的在前
    expect(suggestions.value.map((item) => item.url)).toEqual([
      "https://example.com/b",
      "https://GitHub.com/a",
    ]);

    urlInput.value = "无关";
    expect(suggestions.value.map((item) => item.url)).toEqual(["https://other.com/c"]);

    urlInput.value = "no-hit";
    expect(suggestions.value).toEqual([]);
  });
});
