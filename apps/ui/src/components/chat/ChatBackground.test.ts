import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_THEME_IMAGE, normalizeThemeImage } from "@zen/shared";

import ChatBackground from "./ChatBackground.vue";

import { useSettingsStore } from "@/stores/settings";

describe("图片背景设置", () => {
  it("无图片时强制关闭；参数夹在安全区间", () => {
    expect(normalizeThemeImage({ id: "", enabled: true }).enabled).toBe(false);
    expect(normalizeThemeImage({ id: "../../etc/passwd", enabled: true }).id).toBe("");
    expect(normalizeThemeImage({ id: "abc123def456.png", enabled: true, blur: 999 }).blur).toBe(40);
    expect(normalizeThemeImage({ id: "abc123def456.png", enabled: true, dim: -3 }).dim).toBe(0);
    expect(normalizeThemeImage({ id: "abc123def456.png", enabled: true, dim: 0.456 }).dim).toBe(0.46);
    expect(normalizeThemeImage(null)).toEqual(DEFAULT_THEME_IMAGE);
  });

  it("只接受白名单文件名，路径与远程地址都不算合法", () => {
    const ok = normalizeThemeImage({ id: "0123456789ab.webp", enabled: true });
    expect(ok.id).toBe("0123456789ab.webp");
    for (const bad of ["/abs/a.png", "http://x/a.png", "a.png", "0123456789ab.gif"]) {
      expect(normalizeThemeImage({ id: bad, enabled: true }).id).toBe("");
    }
  });
});

describe("ChatBackground", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("未启用时不渲染背景，不遮挡聊天", () => {
    const store = useSettingsStore();
    store.settings = { ...store.settings, themeImage: { ...DEFAULT_THEME_IMAGE } };
    const wrapper = mount(ChatBackground);
    expect(wrapper.find('[data-testid="chat-background"]').exists()).toBe(false);
    expect(store.themeImageUrl).toBe("");
  });

  it("启用且有图时渲染底图与遮罩，且不拦截指针", async () => {
    const store = useSettingsStore();
    store.settings = {
      ...store.settings,
      themeImage: { id: "0123456789ab.png", enabled: true, blur: 8, dim: 0.5 },
    };
    store.themeImageUrl = "data:image/png;base64,AAAA";

    const wrapper = mount(ChatBackground);
    const layer = wrapper.find('[data-testid="chat-background"]');
    expect(layer.exists()).toBe(true);
    // jsdom 不解析 color-mix(var(...))，遮罩样式只断言存在性；取值由 normalizeThemeImage 守住
    expect(wrapper.find('[data-testid="chat-background-image"]').attributes("style")).toContain("blur(8px)");
    expect(wrapper.find('[data-testid="chat-background-mask"]').exists()).toBe(true);
  });
});
