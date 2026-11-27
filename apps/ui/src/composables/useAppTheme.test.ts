import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import { cachedTheme, useAppTheme } from "./useAppTheme";

import {
  DEFAULT_THEME,
  THEME_MODES,
  THEME_PRESETS,
  isDarkPreset,
  normalizeTheme,
  resolveThemePreset,
} from "@zen/shared";

describe("主题预设", () => {
  it("七套预设 + 跟随系统，顺序与色卡一一对应", () => {
    expect(THEME_PRESETS).toHaveLength(7);
    expect(THEME_MODES).toEqual([...THEME_PRESETS, "system"]);
  });

  it("非法值与旧字段回退到默认，合法值原样保留", () => {
    expect(normalizeTheme("mist")).toBe("mist");
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("paper")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(42)).toBe(DEFAULT_THEME);
  });

  it("system 按系统外观解析，固定预设不随系统变", () => {
    expect(resolveThemePreset("system", true)).toBe("dark");
    expect(resolveThemePreset("system", false)).toBe("light");
    expect(resolveThemePreset("cream", true)).toBe("cream");
    expect(isDarkPreset("ink")).toBe(true);
    expect(isDarkPreset("mist")).toBe(false);
  });

  it("切到预设后写入 data-theme 与 dark 类，供 CSS 与 Tailwind 共用", async () => {
    const { setThemeMode } = useAppTheme();
    setThemeMode("graphite");
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    setThemeMode("cream");
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe("cream");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("首帧镜像读回上次主题；旧版只有深浅时回退成 light/dark", () => {
    localStorage.setItem("zen.theme.id", "sunset");
    expect(cachedTheme()).toEqual({ preset: "sunset", dark: true });

    localStorage.removeItem("zen.theme.id");
    localStorage.setItem("zen.theme.dark", "0");
    expect(cachedTheme()).toEqual({ preset: "light", dark: false });

    localStorage.clear();
    expect(cachedTheme().preset).toBe("light");
  });
});

describe("自定义主题应用", () => {
  it("选中 custom:<id> 时把推导结果写进 :root，切回预设后清掉", async () => {
    const { setThemeMode, setCustomThemes, isDark } = useAppTheme();
    const theme = {
      id: "abc12345",
      name: { zh: "暖夜" },
      base: "dark" as const,
      seeds: { accent: "#e98a4f", background: "#1d1512", surface: "#271c17", text: "#f6ece4" },
    };
    setCustomThemes([theme]);
    setThemeMode("custom:abc12345");
    await nextTick();

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-panel")).toBe("#271c17");
    expect(root.dataset.theme).toBe("dark");
    expect(isDark.value).toBe(true);

    setThemeMode("light");
    await nextTick();
    expect(root.style.getPropertyValue("--color-panel")).toBe("");
    expect(root.dataset.theme).toBe("light");
  });

  it("指向不存在的自定义主题时回退预设，不会停在半套颜色上", async () => {
    const { setThemeMode, setCustomThemes } = useAppTheme();
    setCustomThemes([]);
    setThemeMode("custom:missing1");
    await nextTick();
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe("");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
