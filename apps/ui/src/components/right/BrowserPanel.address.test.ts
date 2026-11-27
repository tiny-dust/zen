import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BrowserPanel from "@/components/right/BrowserPanel.vue";
import { i18n } from "@/locales";
import { useBrowserStore } from "@/stores/browser";

import type { BrowserStatus } from "@zen/shared";

const runningStatus: BrowserStatus = {
  state: "running",
  chromeVersion: "0",
  electronVersion: "0",
  kernelSource: "",
  pageId: 1,
  url: "",
  title: "",
  picking: false,
  visible: false,
  pip: false,
  pipHidden: false,
  canGoBack: false,
  canGoForward: false,
};

function browserMock(overrides: Record<string, unknown> = {}) {
  return {
    status: async () => runningStatus,
    ensureRunning: async () => runningStatus,
    setBounds: async () => runningStatus,
    setVisible: async () => runningStatus,
    focusHost: vi.fn(async () => ({ ok: true })),
    getSettings: async () => ({ userAgent: "", zoomPercent: 100 }),
    open: vi.fn(async (url: string) => ({ ok: true, url, title: "" })),
    onStatus: () => () => undefined,
    onElementPicked: () => () => undefined,
    ...overrides,
  };
}

async function mountPanel(browser = browserMock()) {
  (window as unknown as { zen: unknown }).zen = { browser };
  const wrapper = mount(BrowserPanel, {
    global: { plugins: [createPinia(), i18n], stubs: { teleport: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, browser };
}

const addressInput = (wrapper: ReturnType<typeof mount>) => wrapper.find("input[aria-label=地址栏]");

describe("BrowserPanel 地址栏焦点", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("点击地址栏（DOM 焦点未变、不会触发 focus）也能唤起历史建议并抢回键盘焦点", async () => {
    const { wrapper, browser } = await mountPanel();
    const store = useBrowserStore();
    store.history = [{ url: "https://example.com/", title: "Example", visitedAt: 1 }];
    await flushPromises();

    expect(wrapper.find("[data-browser-suggestions]").exists()).toBe(false);
    await addressInput(wrapper).trigger("pointerdown");
    await flushPromises();

    expect(wrapper.find("[data-browser-suggestions]").exists()).toBe(true);
    expect(browser.focusHost).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("抢焦点引起的 blur 不关闭建议：焦点仍在地址栏就当我没离开", async () => {
    const { wrapper } = await mountPanel();
    const store = useBrowserStore();
    store.history = [{ url: "https://example.com/", title: "Example", visitedAt: 1 }];
    await flushPromises();

    const input = addressInput(wrapper);
    await input.trigger("focus");
    (input.element as HTMLInputElement).focus();
    await flushPromises();
    expect(wrapper.find("[data-browser-suggestions]").exists()).toBe(true);

    // focusHost 回程会让 DOM 失焦一次：blur 事件到达时 relatedTarget 为空
    await input.trigger("blur");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    expect(wrapper.find("[data-browser-suggestions]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("失去真实焦点后建议关闭", async () => {
    const { wrapper } = await mountPanel();
    const store = useBrowserStore();
    store.history = [{ url: "https://example.com/", title: "Example", visitedAt: 1 }];
    await flushPromises();

    await addressInput(wrapper).trigger("focus");
    // 真实失焦：焦点去了面板里别的控件（不是掉到 body，那种会被我们抢回来）
    const settingsBtn = wrapper.find("button[aria-label=浏览器设置]");
    (settingsBtn.element as HTMLElement).focus();
    await addressInput(wrapper).trigger("blur");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    expect(wrapper.find("[data-browser-suggestions]").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("BrowserPanel 打开失败", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("没有可用页面时回到新标签页，并把错误留在面板上", async () => {
    const browser = browserMock({
      open: vi.fn(async () => ({ ok: false, url: "https://fail.test", title: "", error: "ERR_NAME_NOT_RESOLVED" })),
    });
    const { wrapper } = await mountPanel(browser);
    const store = useBrowserStore();
    store.showHome = true;

    await store.openUrl("https://fail.test");
    await flushPromises();

    expect(store.panelNote).toBe("ERR_NAME_NOT_RESOLVED");
    expect(store.showHome).toBe(true);
    expect(wrapper.text()).toContain("ERR_NAME_NOT_RESOLVED");
    wrapper.unmount();
  });
});
