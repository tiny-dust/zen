import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CODE_THEMES,
  codeThemeId,
  codeThemePair,
  compactCodeOptions,
  setCodeThemeId,
  streamMarkdownExtensions,
  withStreamingHighlight,
} from "@/components/ai-elements/response/extensions";

describe("extensions 代码主题", () => {
  it("CODE_THEMES 每项均有成对深浅主题与唯一 id", () => {
    expect(CODE_THEMES.length).toBeGreaterThan(0);
    const ids = new Set(CODE_THEMES.map((item) => item.id));
    expect(ids.size).toBe(CODE_THEMES.length);
    for (const theme of CODE_THEMES) {
      expect(theme.label).toBeTruthy();
      expect(theme.light).toBeTruthy();
      expect(theme.dark).toBeTruthy();
    }
  });

  it("setCodeThemeId 接受合法 id、拒绝未知 id、忽略重复设置", () => {
    const original = codeThemeId.value;

    setCodeThemeId("vs");
    expect(codeThemeId.value).toBe("vs");

    setCodeThemeId("not-a-theme");
    expect(codeThemeId.value).toBe("vs");

    // 与当前一致时不动
    setCodeThemeId("vs");
    expect(codeThemeId.value).toBe("vs");

    setCodeThemeId(original);
  });

  it("codeThemePair 返回 [light, dark]，未知 id 回退到第一项", () => {
    const first = CODE_THEMES[0]!;
    expect(codeThemePair("github")).toEqual(["github-light", "github-dark"]);
    expect(codeThemePair("nope")).toEqual([first.light, first.dark]);
    // 缺省取当前 codeThemeId
    setCodeThemeId("catppuccin");
    expect(codeThemePair()).toEqual(["catppuccin-latte", "catppuccin-mocha"]);
  });

  it("compactCodeOptions 开启行号并限制高度", () => {
    expect(compactCodeOptions.lineNumbers).toBe(true);
    expect(compactCodeOptions.maxHeight).toBe(420);
  });

  it("streamMarkdownExtensions 挂接 code 扩展", () => {
    expect(streamMarkdownExtensions.code).toBeTruthy();
  });
});

describe("withStreamingHighlight 流式高亮节流", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBase() {
    const calls: string[] = [];
    const base = {
      name: "code",
      highlight: (input: { code: string }) => {
        calls.push(input.code);
        return Promise.resolve({ tokens: input.code.length });
      },
    };
    return { base, calls };
  }

  it("首次调用立即高亮，不等待节流窗口", () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "abc" });
    expect(calls).toEqual(["abc"]);
  });

  it("同块连续增长合并为一次高亮，静止后用最新内容重跑", async () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "a" }); // 立即
    void ext.highlight({ code: "ab" }); // 增长 → 挂起
    void ext.highlight({ code: "abc" }); // 增长 → 合并，旧的立即落定
    expect(calls).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(260);
    expect(calls).toEqual(["a", "abc"]);
  });

  it("增长流持续不停时按 maxWait 强制周期性重高亮", async () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "x" });
    // 每 100ms 追加增长一次（同块前缀增长），持续 2.2s：静止条件永不满足，只能靠 maxWait 触发
    for (let i = 1; i <= 22; i++) {
      vi.advanceTimersByTime(100);
      void ext.highlight({ code: "x" + "y".repeat(i) });
    }
    expect(calls.length).toBeGreaterThanOrEqual(3); // 首次 + 周期性强制（~1s 一次）
    expect(calls.length).toBeLessThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls.at(-1)).toBe("x" + "y".repeat(22));
  });

  it("不同代码块到达时立即补跑挂起的高亮（静态多块渲染不漏色）", async () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "block-a" }); // 立即
    void ext.highlight({ code: "block-a-more" }); // 同块增长 → 挂起
    expect(calls).toEqual(["block-a"]);
    void ext.highlight({ code: "block-b" }); // 不同块 → 立即补跑挂起的 block-a-more
    expect(calls).toEqual(["block-a", "block-a-more"]);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toEqual(["block-a", "block-a-more", "block-b"]);
  });

  it("静止 quietMs 后再次更新立即高亮（主题切换 / 收尾上色）", async () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "a" });
    void ext.highlight({ code: "ab" });
    await vi.advanceTimersByTimeAsync(1000); // 静止超过 quietMs，挂起已冲刷
    expect(calls).toEqual(["a", "ab"]);
    void ext.highlight({ code: "ab" }); // 再次更新（如 isDark 切换）：立即
    expect(calls).toEqual(["a", "ab", "ab"]);
  });

  it("被合并的旧 promise 立即落定（不悬挂 await）", async () => {
    const { base, calls } = makeBase();
    const ext = withStreamingHighlight(base, 250, 1000);
    void ext.highlight({ code: "a" });
    const stale = ext.highlight({ code: "ab" });
    const latest = ext.highlight({ code: "abc" });
    // 被合并的旧 promise 立即落定 undefined（调用方版本守卫会丢弃该结果）
    await expect(stale).resolves.toBeUndefined();
    // 最新输入经尾随窗口重跑后携带真实结果
    await vi.advanceTimersByTimeAsync(300);
    await expect(latest).resolves.toEqual({ tokens: 3 });
    expect(calls).toEqual(["a", "abc"]);
  });
});
