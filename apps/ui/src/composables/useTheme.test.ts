import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_THEME } from "@zen/shared";

import { initTheme, resolveInitialTheme, useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = "";
    document.documentElement.classList.remove("dark", "theme-switching");
    vi.restoreAllMocks();
  });

  it("无持久化记录时回落默认液态玻璃", () => {
    expect(resolveInitialTheme()).toBe(DEFAULT_UI_THEME);
  });

  it("initTheme 落 data-theme 与 .dark，且返回初始主题", () => {
    const initial = initTheme();
    expect(initial).toBe("liquid-glass");
    expect(document.documentElement.dataset.theme).toBe("liquid-glass");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("localStorage 里的非法值被忽略", () => {
    window.localStorage.setItem("zen:ui-theme", "solarized");
    expect(resolveInitialTheme()).toBe(DEFAULT_UI_THEME);
  });

  it("setTheme 即时切换 DOM 并双写持久化", async () => {
    initTheme();
    const { theme, setTheme } = useTheme();
    await setTheme("dark-tech");

    expect(theme.value).toBe("dark-tech");
    expect(document.documentElement.dataset.theme).toBe("dark-tech");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("zen:ui-theme")).toBe("dark-tech");
  });

  it("拟态主题摘掉 .dark（浅色）", async () => {
    initTheme();
    const { setTheme } = useTheme();
    await setTheme("neumorphism");

    expect(document.documentElement.dataset.theme).toBe("neumorphism");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("重复设置同值不产生副作用", async () => {
    initTheme();
    const { theme, setTheme } = useTheme();
    await setTheme("liquid-glass");
    expect(theme.value).toBe("liquid-glass");
  });

  it("syncFromSettings 接受合法值并同步 DOM 与 localStorage", () => {
    initTheme();
    const { syncFromSettings } = useTheme();
    syncFromSettings("neumorphism");

    expect(document.documentElement.dataset.theme).toBe("neumorphism");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("zen:ui-theme")).toBe("neumorphism");
  });

  it("syncFromSettings 忽略非法值", () => {
    initTheme();
    const { syncFromSettings } = useTheme();
    syncFromSettings("hacker-green" as never);

    expect(document.documentElement.dataset.theme).toBe("liquid-glass");
  });

  it("切换会持久化到主进程设置（zen API 存在时）", async () => {
    const setMock = vi.fn(async () => ({}));
    (window as never as { zen: unknown }).zen = {
      settings: { set: setMock },
    };

    initTheme();
    const { setTheme } = useTheme();
    await setTheme("dark-tech");

    expect(setMock).toHaveBeenCalledWith({ uiTheme: "dark-tech" });
    delete (window as never as { zen?: unknown }).zen;
  });
});
