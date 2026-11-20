import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelPicker from "@/components/chat/ModelPicker.vue";
import VendorLogo from "@/components/brand/VendorLogo.vue";
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
    await flushPromises();
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
    await flushPromises();
    expect(models.autoRoute).toBe(false);
    wrapper.unmount();
  });
});

describe("ModelPicker 小屏头像组", () => {
  it("P/A 双模型开启时叠放两个品牌图标，关闭时仍是一个", async () => {
    const chat = useChatStore();
    // 关闭 P/A：只有一个图标（全局阶段默认不再强制双模型展示）
    const single = mount(ModelPicker, { props: { compact: true } });
    expect(single.findAllComponents(VendorLogo).length).toBe(1);
    single.unmount();

    // 本会话开启 P/A → 双模型头像组
    await chat.setPairMode(true);
    const dual = mount(ModelPicker, { props: { compact: true } });
    expect(dual.findAllComponents(VendorLogo).length).toBe(2);
    dual.unmount();
  });
});

describe("ModelPicker P/A 二级 tab", () => {
  it("计划 / 执行各一个 tab，选完一段可直接切到另一段并显示状态", async () => {
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
    await wrapper.get("button").trigger("click");
    await buttonByText(wrapper, "P/A").trigger("click");
    await flushPromises();
    // 点 tab 即开启本会话 P/A 双模型
    expect(chat.pairMode).toBe(true);

    // 二级 tab：计划 / 执行，tab 上直接显示该段生效模型与来源
    const planTab = () => wrapper.get("button[aria-label='编辑计划模型']");
    const actTab = () => wrapper.get("button[aria-label='编辑执行模型']");
    expect(planTab().text()).toContain("计划");
    expect(planTab().text()).toContain("Executor");
    expect(planTab().text()).toContain("全局默认");
    expect(actTab().text()).toContain("执行");
    expect(actTab().text()).toContain("Reasoner");
    expect(actTab().text()).toContain("会话模型");
    // 选模型时明确「正在为哪个阶段选」
    expect(wrapper.get('input[type="search"]').attributes("placeholder")).toBe("为「计划」选择模型…");

    // 选计划：只写计划覆盖，弹层保持打开（两段状态同时可见）
    await buttonByText(wrapper, "Reasoner").trigger("click");
    await flushPromises();
    expect(chat.planModel).toEqual({ providerId: "p1", modelId: "m1" });
    expect(chat.actModel).toBeNull();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    expect(planTab().text()).toContain("本会话指定");

    // 直接切到执行 tab 再选：只写执行覆盖，计划覆盖不动
    await actTab().trigger("click");
    expect(wrapper.get('input[type="search"]').attributes("placeholder")).toBe("为「执行」选择模型…");
    await buttonByText(wrapper, "Executor").trigger("click");
    await flushPromises();
    expect(chat.actModel).toEqual({ providerId: "p1", modelId: "m2" });
    expect(chat.planModel).toEqual({ providerId: "p1", modelId: "m1" });
    // 两个 tab 的状态各自更新（zen-001：状态只出现在对应 tab 上）
    expect(planTab().text()).toContain("Reasoner");
    expect(actTab().text()).toContain("Executor");

    // 触发器：双模型时两个名字都要出现（计划 Reasoner → 执行 Executor）
    const trigger = wrapper.get("button[aria-label^='计划 ']");
    expect(trigger.text()).toContain("Reasoner");
    expect(trigger.text()).toContain("Executor");

    // 会话模式决定真正生效的那一段：interactive 用执行模型，plan 用计划模型
    expect(chat.activeModelSelection).toEqual({ providerId: "p1", modelId: "m2" });
    await chat.setSessionMode("plan");
    expect(chat.activeModelSelection).toEqual({ providerId: "p1", modelId: "m1" });

    // 关闭再打开：两段状态从 store 恢复
    await wrapper.get("button").trigger("click");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(planTab().text()).toContain("Reasoner");
    expect(actTab().text()).toContain("Executor");

    // 清除计划覆盖：回落全局默认（Executor）
    await planTab().trigger("click");
    const followGlobal = wrapper
      .findAll('[role="listbox"] button')
      .find((button) => button.text().includes("跟随全局默认"));
    expect(followGlobal).toBeTruthy();
    await followGlobal!.trigger("click");
    await flushPromises();
    expect(chat.planModel).toBeNull();
    expect(chat.actModel?.modelId).toBe("m2");
    wrapper.unmount();
  });

  it("模型 tab 选单个模型会退出 P/A 并关闭弹层", async () => {
    const chat = useChatStore();
    const wrapper = mount(ModelPicker);
    await wrapper.get("button").trigger("click");
    await buttonByText(wrapper, "P/A").trigger("click");
    await flushPromises();
    expect(chat.pairMode).toBe(true);

    await buttonByText(wrapper, "模型").trigger("click");
    await buttonByText(wrapper, "Reasoner").trigger("click");
    await flushPromises();
    expect(chat.pairMode).toBe(false);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
