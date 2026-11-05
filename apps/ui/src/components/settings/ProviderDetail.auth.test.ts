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

describe("Codex 手动回调登录", () => {
  it("打开浏览器授权后粘贴回调地址完成登录", async () => {
    const emptyUsage = {
      providerId: provider.id,
      source: "local",
      total: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
      today: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
      byModel: [],
      updatedAt: null,
    };
    const chatgptStatus = vi.fn()
      .mockResolvedValueOnce({ loggedIn: false, expiresAt: 0 })
      .mockResolvedValue({ loggedIn: true, email: "codex@example.com", planType: "plus", expiresAt: 1 });
    const codexLoginStart = vi.fn().mockResolvedValue({
      authorizeUrl: "https://auth.openai.com/oauth/authorize?client_id=x",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    const codexLoginComplete = vi.fn().mockResolvedValue({
      status: { loggedIn: true, email: "codex@example.com", expiresAt: 1 },
      provider,
    });
    vi.stubGlobal("zen", { models: {
      chatgptStatus,
      codexLoginStart,
      codexLoginComplete,
      getUsage: vi.fn().mockResolvedValue(emptyUsage),
    } });

    const wrapper = mount(ProviderDetail, { props: { provider } });
    await flushPromises();

    const start = wrapper.findAll("button").find((button) => button.text().includes("打开浏览器授权"));
    expect(start).toBeTruthy();
    await start!.trigger("click");
    await flushPromises();
    expect(codexLoginStart).toHaveBeenCalledWith(provider.id);

    const callback = wrapper.find('input[placeholder*="回调地址"]');
    await callback.setValue("http://localhost:1455/auth/callback?code=abc&state=xyz");
    const confirm = wrapper.findAll("button").find((button) => button.text().includes("确认登录"));
    expect(confirm).toBeTruthy();
    await confirm!.trigger("click");
    await flushPromises();

    expect(codexLoginComplete).toHaveBeenCalledWith(
      provider.id,
      "http://localhost:1455/auth/callback?code=abc&state=xyz",
    );
    expect(wrapper.emitted("authorized")?.[0]).toEqual([provider.id]);
    expect(wrapper.text()).toContain("codex@example.com");
    wrapper.unmount();
  });
});
