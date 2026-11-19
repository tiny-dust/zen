import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelPicker from "@/components/chat/ModelPicker.vue";
import { i18n } from "@/locales";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";

import type { AppLocale, ProviderSummary } from "@zen/shared";

const provider: ProviderSummary = {
  id: "p1", name: "Test", protocol: "openai-chat", baseUrl: "", enabled: true,
  hasApiKey: false, apiKeyMask: "", createdAt: 1, updatedAt: 1,
  models: [{ id: "m1", name: "Reasoner", enabled: true, capabilities: { reasoning: true } }],
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  vi.stubGlobal("zen", {
    models: {
      list: vi.fn().mockResolvedValue([provider]),
      selection: vi.fn().mockResolvedValue({ providerId: "p1", modelId: "m1" }),
    },
  });
  const models = useModelsStore();
  models.providers = [provider];
  models.selection = { providerId: "p1", modelId: "m1" };
});

afterEach(() => {
  i18n.global.locale.value = "zh-CN" as AppLocale;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** 弹层里的按钮按可见文本定位（tab / 模型项 / 顶部首项） */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper
    .findAll('[role="listbox"] button')
    .find((button) => button.text().trim() === text);
  if (!found) {
    throw new Error(`button not found: ${text}`);
  }
  return found;
}

describe("ModelPicker 自动选择文案", () => {
  it.each([
    ["zh-CN", "自动选择模型", "每次发送前，从已启用模型中按请求选择"],
    ["en-US", "Auto-select model", "Choose from enabled models before each send"],
  ] as const)("%s 展示动作与选择范围，不渲染裸键", async (locale, label, subtitle) => {
    i18n.global.locale.value = locale;
    const wrapper = mount(ModelPicker, { props: { compact: true } });
    await wrapper.get("button").trigger("click");

    const auto = wrapper.get(`button[aria-label^="${label}"]`);
    expect(auto.text()).toContain(label);
    expect(auto.text()).toContain(subtitle);
    expect(auto.text()).not.toContain("modelRouting.auto");
    expect(wrapper.get('[role="listbox"] .grid').classes()).toContain("grid-cols-1");
    wrapper.unmount();
  });

  it("自动选择保留说明及上次记录，手动选择关闭自动", async () => {
    const models = useModelsStore();
    const wrapper = mount(ModelPicker);
    await wrapper.get("button").trigger("click");
    await wrapper.get('button[aria-label^="自动选择模型"]').trigger("click");
    expect(models.autoRoute).toBe(true);

    models.noteRouting({ providerId: "p1", modelId: "m1", rules: ["reasoning-task"], score: 40 });
    await wrapper.get("button").trigger("click");
    const auto = wrapper.get('button[aria-label^="自动选择模型"]');
    expect(auto.text()).toContain("每次发送前，从已启用模型中按请求选择");
    expect(auto.text()).toContain("上次自动选择：Reasoner");
    expect(wrapper.text()).toContain("优先推理模型");

    const model = wrapper.findAll('[role="listbox"] button').find((button) => button.text().trim() === "Reasoner");
    expect(model).toBeTruthy();
    await model!.trigger("click");
    expect(models.autoRoute).toBe(false);
    wrapper.unmount();
  });
});

describe("ModelPicker 阶段模型 tab", () => {
  it("Plan 与 Act 的会话覆盖互不影响，清除后回落全局默认/会话模型", async () => {
    const models = useModelsStore();
    const chat = useChatStore();
    const settings = useSettingsStore();
    const providers = [{ ...provider, models: [
      ...provider.models,
      { id: "m2", name: "Executor", enabled: true },
    ] }];
    models.providers = providers;
    vi.mocked(window.zen!.models.list).mockResolvedValue(providers);
    // 设置页配置：Plan 全局默认为 Executor
    settings.settings = {
      ...settings.settings,
      planModel: { providerId: "p1", modelId: "m2" },
    };

    const wrapper = mount(ModelPicker);

    // 执行 tab：选中 Reasoner，只写会话 Act 覆盖
    await wrapper.get("button").trigger("click");
    await buttonByText(wrapper, "执行 (Act)").trigger("click");
    await buttonByText(wrapper, "Reasoner").trigger("click");
    expect(chat.actModel?.modelId).toBe("m1");
    expect(chat.planModel).toBeNull();

    // 计划 tab：会话未覆盖时顶部展示全局默认
    await wrapper.get("button").trigger("click");
    await buttonByText(wrapper, "计划 (Plan)").trigger("click");
    expect(wrapper.get('[role="listbox"]').text()).toContain("全局默认：Test / Executor");
    await buttonByText(wrapper, "Reasoner").trigger("click");
    expect(chat.planModel?.modelId).toBe("m1");
    // 两个阶段互不覆盖
    expect(chat.actModel?.modelId).toBe("m1");

    // 计划阶段覆盖生效时，plan 模式使用会话覆盖
    await chat.setSessionMode("plan");
    expect(chat.activeModelSelection).toEqual({ providerId: "p1", modelId: "m1" });

    // 清除计划覆盖：回落 Plan 全局默认（Executor）
    await wrapper.get("button").trigger("click");
    const followGlobal = wrapper
      .findAll('[role="listbox"] button')
      .find((button) => button.text().includes("跟随全局默认"));
    expect(followGlobal).toBeTruthy();
    await followGlobal!.trigger("click");
    expect(chat.planModel).toBeNull();
    expect(chat.actModel?.modelId).toBe("m1");
    expect(chat.activeModelSelection).toEqual({ providerId: "p1", modelId: "m2" });

    // 没有全局默认时回落会话模型
    settings.settings = { ...settings.settings, planModel: null };
    expect(chat.activeModelSelection).toEqual({ providerId: "p1", modelId: "m1" });
    wrapper.unmount();
  });
});
