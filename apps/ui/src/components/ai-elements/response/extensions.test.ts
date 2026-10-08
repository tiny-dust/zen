import { describe, expect, it } from "vitest";

import {
  CODE_THEMES,
  codeThemeId,
  codeThemePair,
  compactCodeOptions,
  setCodeThemeId,
  streamMarkdownExtensions,
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
