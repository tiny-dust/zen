import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelPicker from "@/components/chat/ModelPicker.vue";
import { i18n } from "@/locales";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";

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

  it("Plan 和 Act 的阶段模型互不覆盖，清除阶段选择后跟随会话", async () => {
    const models = useModelsStore();
    const chat = useChatStore();
    const providers = [{ ...provider, models: [
      ...provider.models,
      { id: "m2", name: "Executor", enabled: true },
    ] }];
    models.providers = providers;
    vi.mocked(window.zen!.models.list).mockResolvedValue(providers);
    const plan = mount(ModelPicker, { props: { phase: "plan" } });
    const act = mount(ModelPicker, { props: { phase: "act" } });
    await plan.get("button").trigger("click");
    await plan.findAll('[role="listbox"] button').find((button) => button.text().trim() === "Reasoner")!.trigger("click");
    await act.get("button").trigger("click");
    await act.findAll('[role="listbox"] button').find((button) => button.text().trim() === "Executor")!.trigger("click");
    expect(chat.planModel?.modelId).toBe("m1");
    expect(chat.actModel?.modelId).toBe("m2");
    expect(models.autoRoute).toBe(false);
    await plan.get("button").trigger("click");
    await plan.get('button[aria-label="跟随会话模型"]').trigger("click");
    expect(chat.planModel).toBeNull();
    expect(chat.actModel?.modelId).toBe("m2");
    plan.unmount();
    act.unmount();
  });
});
