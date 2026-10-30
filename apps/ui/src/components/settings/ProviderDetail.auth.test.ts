import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProviderDetail from "@/components/settings/ProviderDetail.vue";

import type { ProviderSummary } from "@zen/shared";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Codex 账号退出状态", () => {
  it("远端撤销失败时仍刷新本机登录态并显示提示", async () => {
    const chatgptStatus = vi.fn()
      .mockResolvedValueOnce({ loggedIn: true, email: "user@example.com", expiresAt: 1 })
      .mockResolvedValue({ loggedIn: false, expiresAt: 0 });
    const chatgptLogout = vi.fn().mockRejectedValue(new Error("revoke failed"));
    vi.stubGlobal("zen", { models: {
      chatgptStatus,
      chatgptLogout,
      getUsage: vi.fn().mockResolvedValue({
        providerId: provider.id,
        source: "local",
        total: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
        today: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
        byModel: [],
        updatedAt: null,
      }),
    } });

    const wrapper = mount(ProviderDetail, { props: { provider } });
    await flushPromises();
    const logout = wrapper.findAll("button").find((button) => button.text().includes("退出登录"));
    expect(logout).toBeTruthy();
    await logout!.trigger("click");
    await flushPromises();

    expect(chatgptStatus).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("未登录");
    expect(wrapper.find('[role="alert"]').text()).toContain("远端授权");
    wrapper.unmount();
  });

  it("切换供应商后忽略旧账号的延迟登录状态", async () => {
    let resolveFirst!: (value: { loggedIn: boolean; email: string; expiresAt: number }) => void;
    const first = new Promise<{ loggedIn: boolean; email: string; expiresAt: number }>((resolve) => { resolveFirst = resolve; });
    const chatgptStatus = vi.fn((id: string) => id === "codex-account"
      ? first
      : Promise.resolve({ loggedIn: true, email: "second@example.com", expiresAt: 1 }));
    vi.stubGlobal("zen", { models: {
      chatgptStatus,
      getUsage: vi.fn().mockResolvedValue({
        providerId: "second",
        source: "local",
        total: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
        today: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
        byModel: [],
        updatedAt: null,
      }),
    } });

    const wrapper = mount(ProviderDetail, { props: { provider } });
    await wrapper.setProps({ provider: { ...provider, id: "second" } });
    await flushPromises();
    resolveFirst({ loggedIn: true, email: "first@example.com", expiresAt: 1 });
    await flushPromises();

    expect(wrapper.text()).toContain("second@example.com");
    expect(wrapper.text()).not.toContain("first@example.com");
    wrapper.unmount();
  });
});
