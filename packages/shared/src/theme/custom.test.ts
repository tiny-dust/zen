import { describe, expect, it } from "vitest";

import {
  ZEN_THEME_TOKENS,
  contrastRatio,
  customThemeValue,
  deriveZenTokens,
  isAdaptiveTheme,
  isSafeColorValue,
  normalizeCustomTheme,
  normalizeThemePack,
  parseCustomThemeValue,
  resolveCustomBase,
} from "../index";

import type { CustomTheme } from "../index";

const THEME: CustomTheme = {
  id: "abc12345",
  name: { zh: "暖夜", en: "Warm night" },
  base: "dark",
  seeds: { accent: "#e98a4f", background: "#1d1512", surface: "#271c17", text: "#f6ece4" },
  variants: { light: { seeds: { accent: "#a8622a", background: "#fbf6ec", surface: "#fffaf2", text: "#2a241d" } } },
};

describe("自定义主题推导", () => {
  it("只产出白名单里的变量，且都是合法颜色", () => {
    const tokens = deriveZenTokens(THEME);
    const allowed = new Set<string>(ZEN_THEME_TOKENS);
    for (const [name, value] of Object.entries(tokens)) {
      expect(allowed.has(name)).toBe(true);
      expect(isSafeColorValue(value)).toBe(true);
    }
    expect(tokens["--color-panel"]).toBe("#271c17");
  });

  it("正文对底色的对比度不低于 4.5", () => {
    const tokens = deriveZenTokens(THEME);
    expect(contrastRatio(tokens["--color-txt-strong"]!, tokens["--color-bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["--color-mut"]!, tokens["--color-panel"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("浅底浅字这种坏输入也会被推到可读", () => {
    const bad = deriveZenTokens({
      base: "light",
      seeds: { background: "#f7f7f7", surface: "#ffffff", text: "#fafafa", accent: "#ffee00" },
    });
    expect(contrastRatio(bad["--color-txt-strong"]!, bad["--color-bg"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("带另一套明暗时跟随系统解析", () => {
    expect(isAdaptiveTheme(THEME)).toBe(true);
    expect(resolveCustomBase(THEME, true)).toBe("dark");
    expect(resolveCustomBase(THEME, false)).toBe("light");
    expect(deriveZenTokens(THEME, "light")["--color-bg"]).toBe("#fbf6ec");
  });
});

describe("主题包归一与选择值", () => {
  it("非法结构返回 null，名称与颜色被清洗", () => {
    expect(normalizeThemePack({ base: "pink", name: "x" })).toBeNull();
    expect(normalizeThemePack({ base: "light", name: "  " })).toBeNull();
    const pack = normalizeThemePack({
      base: "light",
      name: "  带控制符\u0007 的名字  ",
      seeds: { accent: "#ABC", bogus: "#fff" },
      tokens: { "--color-bg": "#ffffff", "--evil": "url(x)", "--color-panel": "red;}" },
    });
    expect(pack?.name.zh).toBe("带控制符 的名字");
    expect(pack?.seeds).toEqual({ accent: "#aabbcc" });
    expect(pack?.tokens).toEqual({ "--color-bg": "#ffffff" });
  });

  it("背景图只接受白名单文件名", () => {
    const ok = normalizeCustomTheme(
      { id: "abc12345", base: "dark", name: "x", background: { id: "0123456789ab.png", blur: 99, dim: 2 } },
    );
    expect(ok?.background).toEqual({ id: "0123456789ab.png", blur: 40, dim: 0.9 });
    const bad = normalizeCustomTheme(
      { id: "abc12345", base: "dark", name: "x", background: { id: "../../x.png" } },
      (id) => id === "0123456789ab.png",
    );
    expect(bad?.background).toBeUndefined();
  });

  it("custom:<id> 往返，非法 id 不认", () => {
    expect(parseCustomThemeValue(customThemeValue("abc12345"))).toBe("abc12345");
    expect(parseCustomThemeValue("custom:AB")).toBeNull();
    expect(parseCustomThemeValue("light")).toBeNull();
  });
});

describe("与 nomi 主题包的字段映射", () => {
  it("nomi 的 --cd-* token 换回 Zen 名字，未知 token 丢弃", async () => {
    const { packFromNomi } = await import("../index");
    const pack = packFromNomi({
      format: 2,
      base: "dark",
      name: "N",
      seeds: { accent: "#e98a4f" },
      tokens: { "--cd-color-surface": "#101010", "--cd-color-bg": "#000000", "--cd-unknown": "#fff" },
      background: { image: "background.png", blur: 12, opacity: 0.8 },
    }) as Record<string, unknown>;
    expect(pack.tokens).toEqual({ "--color-panel": "#101010", "--color-bg": "#000000" });
    expect(pack.background).toEqual({ id: "background.png", blur: 12, dim: 0.8 });
  });

  it("导出用 nomi 字段名，背景写成 image/opacity", async () => {
    const { packToNomi } = await import("../index");
    const out = packToNomi(
      {
        name: { zh: "暖夜" },
        base: "dark",
        seeds: { accent: "#e98a4f" },
        tokens: { "--color-panel": "#101010" },
        background: { id: "", blur: 6, dim: 0.5 },
      },
      "background.webp",
    );
    expect(out.format).toBe(2);
    expect(out.tokens).toEqual({ "--cd-color-surface": "#101010" });
    expect(out.background).toEqual({ image: "background.webp", blur: 6, opacity: 0.5 });
  });
});
