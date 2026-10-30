import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import CodexUsagePanel from "@/components/settings/CodexUsagePanel.vue";

import type { ProviderUsageSnapshot } from "@zen/shared";

function snapshot(providerId: string, tokens: number): ProviderUsageSnapshot {
  const usage = {
    inputTokens: tokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: tokens,
    usageEvents: 1,
  };
  return { providerId, source: "local", total: usage, today: usage, byModel: [], updatedAt: null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Codex 用量面板", () => {
  it("切换供应商后忽略旧供应商的延迟结果", async () => {
    let resolveFirst!: (value: ProviderUsageSnapshot) => void;
    const first = new Promise<ProviderUsageSnapshot>((resolve) => { resolveFirst = resolve; });
    const getUsage = vi.fn((id: string) => id === "first" ? first : Promise.resolve(snapshot(id, 222)));
    vi.stubGlobal("zen", { models: { getUsage }, app: { openSystemExternal: vi.fn() } });

    const wrapper = mount(CodexUsagePanel, { props: { providerId: "first", accountMode: true } });
    await wrapper.setProps({ providerId: "second" });
    await flushPromises();
    resolveFirst(snapshot("first", 111));
    await flushPromises();

    expect(getUsage).toHaveBeenCalledWith("second");
    expect(wrapper.text()).toContain("222");
    expect(wrapper.text()).not.toContain("111");
    wrapper.unmount();
  });

  it("ChatGPT 账号打开官方用量页", async () => {
    const openSystemExternal = vi.fn();
    vi.stubGlobal("zen", {
      models: { getUsage: vi.fn().mockResolvedValue(snapshot("account", 0)) },
      app: { openSystemExternal },
    });
    const wrapper = mount(CodexUsagePanel, { props: { providerId: "account", accountMode: true } });
    await flushPromises();
    const official = wrapper.findAll("button").find((button) => button.text().includes("查看官方额度"));
    expect(official).toBeTruthy();
    await official!.trigger("click");
    expect(openSystemExternal).toHaveBeenCalledWith("https://chatgpt.com/settings/usage");
    wrapper.unmount();
  });
});
