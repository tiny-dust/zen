import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsModels from "@/components/settings/SettingsModels.vue";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useModelsStore } from "@/stores/models";

import type { ProviderSummary } from "@zen/shared";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Codex 账号新增入口", () => {
  it("创建账号供应商并进入手动回调登录页面", async () => {
    const provider: ProviderSummary = {
      id: "codex-account",
      name: "Codex",
      protocol: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      authMode: "chatgpt-oauth",
      enabled: true,
      hasApiKey: false,
      apiKeyMask: "",
      models: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const addProvider = vi.fn().mockResolvedValue(provider);
    const chatgptLogin = vi.fn();
    vi.stubGlobal("zen", { models: {
      addProvider,
      chatgptLogin,
      list: vi.fn().mockResolvedValue([provider]),
      selection: vi.fn().mockResolvedValue({ providerId: null, modelId: null }),
    } });
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(SettingsModels, { global: { plugins: [pinia] }, attachTo: document.body });
    await wrapper.find('[data-slot="dropdown-menu-trigger"]').trigger("click");
    await flushPromises();
    const accountItem = wrapper.findAllComponents(DropdownMenuItem)
      .find((item) => item.text().includes("ChatGPT 账号"));
    expect(accountItem).toBeTruthy();

    accountItem!.vm.$emit("select");
    await flushPromises();

    expect(addProvider).toHaveBeenCalledWith({
      name: "Codex",
      protocol: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      authMode: "chatgpt-oauth",
    });
    expect(chatgptLogin).not.toHaveBeenCalled();
    expect(useModelsStore().activeProviderId).toBe(provider.id);
    expect(wrapper.findComponent({ name: "ProviderDetail" }).exists()).toBe(true);
    expect(wrapper.text()).toContain("打开浏览器授权");
    expect(wrapper.text()).not.toContain("自动回调登录");
    wrapper.unmount();
  });
});
