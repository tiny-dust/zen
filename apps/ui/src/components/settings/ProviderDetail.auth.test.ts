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

describe("Codex 登录过期后的重新授权", () => {
  const emptyUsage = {
    providerId: provider.id,
    source: "local",
    total: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
    today: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
    byModel: [],
    updatedAt: null,
  };

  it("过期时刷新按钮改为重新授权，并直接发起浏览器授权", async () => {
    const chatgptStatus = vi.fn().mockResolvedValue({
      loggedIn: true,
      email: "codex@example.com",
      expiresAt: 1,
    });
    const chatgptRefresh = vi.fn().mockResolvedValue({
      status: { loggedIn: false, expiresAt: 0 },
      error: "ChatGPT 登录已失效，请重新登录",
    });
    const codexLoginStart = vi.fn().mockResolvedValue({
      authorizeUrl: "https://auth.openai.com/oauth/authorize?client_id=x",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    vi.stubGlobal("zen", { models: {
      chatgptStatus,
      chatgptRefresh,
      codexLoginStart,
      getUsage: vi.fn().mockResolvedValue(emptyUsage),
    } });

    const wrapper = mount(ProviderDetail, { props: { provider } });
    await flushPromises();

    expect(wrapper.text()).toContain("登录已过期");
    const reauthorize = wrapper.findAll("button").find((button) => button.text().includes("重新授权"));
    expect(reauthorize).toBeTruthy();
    await reauthorize!.trigger("click");
    await flushPromises();

    expect(chatgptRefresh).toHaveBeenCalledWith(provider.id);
    expect(codexLoginStart).toHaveBeenCalledWith(provider.id);
    expect(wrapper.find('[role="alert"]').text()).toContain("已失效");
    wrapper.unmount();
  });

  it("回调地址输入框带边框与背景，可辨识输入位置", async () => {
    const chatgptStatus = vi.fn().mockResolvedValue({ loggedIn: false, expiresAt: 0 });
    vi.stubGlobal("zen", { models: {
      chatgptStatus,
      getUsage: vi.fn().mockResolvedValue(emptyUsage),
    } });

    const wrapper = mount(ProviderDetail, { props: { provider } });
    await flushPromises();

    const callback = wrapper.find('input[placeholder*="回调地址"]');
    expect(callback.exists()).toBe(true);
    const className = callback.classes().join(" ");
    expect(className).toContain("border-[var(--color-line)]");
    expect(className).toContain("bg-[var(--color-np-btn-bg)]");
    wrapper.unmount();
  });
});
