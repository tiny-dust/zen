import { mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContextUsagePicker, { formatTokens } from "@/components/chat/ContextUsagePicker.vue";
import { useChatStore } from "@/stores/chat";

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  vi.stubGlobal("zen", {
    git: {
      info: vi.fn().mockResolvedValue({ repo: "zen", branch: "feature/test" }),
      status: vi.fn().mockResolvedValue(null),
    },
  });
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("formatTokens", () => {
  it("缩写 K/M，K/M 以内保留一位小数", () => {
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(166_100)).toBe("166.1K");
    expect(formatTokens(200_000)).toBe("200K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(22_400_000)).toBe("22.4M");
  });
});

describe("ContextUsagePicker", () => {
  it("打开弹层展示本轮上下文数据，ESC 关闭", async () => {
    const chat = useChatStore();
    chat.lastInputTokens = 166_100;
    chat.lastCachedInputTokens = 165_400;
    chat.sessionTotalTokens = 22_400_000;

    const wrapper = mount(ContextUsagePicker, { attachTo: document.body });
    // 触发器常驻（未选模型时 contextUsage 为 null，只显示图标——与旧底栏行为一致）
    const trigger = wrapper.find("button");
    expect(trigger.attributes("aria-label")).toBe("上下文用量");

    await trigger.trigger("click");
    const popup = document.querySelector('[role="dialog"]');
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toContain("本轮上下文");
    expect(popup?.textContent).toContain("166.1K");
    // 缓存命中：165400 / 166100 ≈ 99.6%
    expect(popup?.textContent).toContain("缓存命中 99.6%");
    expect(popup?.textContent).toContain("会话消耗：22.4M tokens");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  it("未上报缓存时显示占位而不是 0%", async () => {
    const chat = useChatStore();
    chat.lastInputTokens = 1000;

    const wrapper = mount(ContextUsagePicker, { attachTo: document.body });
    await wrapper.find("button").trigger("click");
    const popup = document.querySelector('[role="dialog"]');
    expect(popup?.textContent).toContain("缓存命中 —");
    wrapper.unmount();
  });

  it("压缩重点选项：点选写入 compressFocus，再点取消", async () => {
    const chat = useChatStore();
    const wrapper = mount(ContextUsagePicker, { attachTo: document.body });
    await wrapper.find("button").trigger("click");
    const popup = document.querySelector('[role="dialog"]') as HTMLElement;

    const chip = (label: string) =>
      [...popup.querySelectorAll("button")].find((el) => el.textContent?.trim() === label);

    const codeChip = chip("代码变更");
    expect(codeChip).toBeTruthy();
    codeChip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(chat.compressFocus).toBe("代码变更");
    expect(codeChip?.getAttribute("aria-pressed")).toBe("true");

    // 多选：追加另一项
    chip("任务目标")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(chat.compressFocus).toBe("代码变更、任务目标");

    // 取消一项：从文本中摘除
    chip("代码变更")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(chat.compressFocus).toBe("任务目标");
    wrapper.unmount();
  });

  it("自定义输入与选项共存于同一 compressFocus", async () => {
    const chat = useChatStore();
    chat.compressFocus = "登录页性能优化";
    const wrapper = mount(ContextUsagePicker, { attachTo: document.body });
    await wrapper.find("button").trigger("click");
    const popup = document.querySelector('[role="dialog"]') as HTMLElement;

    const input = popup.querySelector("input");
    expect((input as HTMLInputElement).value).toBe("登录页性能优化");
    const codeChip = [...popup.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "代码变更",
    );
    codeChip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(chat.compressFocus).toBe("登录页性能优化、代码变更");
    wrapper.unmount();
  });
});
