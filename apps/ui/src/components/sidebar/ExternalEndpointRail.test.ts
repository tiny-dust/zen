import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/locales";
import { useExternalSessionsStore } from "@/stores/external-sessions";
import { useRightPanelStore } from "@/stores/right-panel";

import ExternalEndpointRail from "./ExternalEndpointRail.vue";

import type { ExternalScanGroup, ExternalSessionsResult } from "@zen/shared";

const GROUPS: ExternalScanGroup[] = [
  { client: "claude", detected: true, count: 3 },
  { client: "codex", detected: true, count: 0 },
  { client: "gemini", detected: false, count: 0 },
  { client: "dsh", detected: false, count: 0 },
  { client: "grok", detected: false, count: 0 },
];

function result(): ExternalSessionsResult {
  return { sessions: [], groups: GROUPS, skipped: 0 };
}

// 只替换 zen 通道，保留真实 window（替换整个 window 会丢掉 Event 等构造器）
function stubZen(list: () => Promise<ExternalSessionsResult>) {
  (window as unknown as { zen: unknown }).zen = {
    externalSessions: { list, trace: async () => ({ id: "", events: [], truncated: false }) },
  };
}

function mountRail(pinia = createPinia()) {
  setActivePinia(pinia);
  return mount(ExternalEndpointRail, { global: { plugins: [pinia, i18n] } });
}

describe("ExternalEndpointRail", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("已检测客户端可点，未检测客户端禁用并说明原因", async () => {
    stubZen(async () => result());
    const wrapper = mountRail();
    await flushPromises();

    const claude = wrapper.find('[data-testid="rail-endpoint-claude"]');
    const gemini = wrapper.find('[data-testid="rail-endpoint-gemini"]');

    expect(claude.attributes("disabled")).toBeUndefined();
    expect(claude.attributes("aria-label")).toContain("3");
    expect(gemini.attributes("disabled")).toBeDefined();
    expect(gemini.attributes("aria-label")).toContain("没有找到会话目录");

    wrapper.unmount();
  });

  it("点一次打开外部会话面板并筛选，再点同一位恢复全部", async () => {
    stubZen(async () => result());
    const pinia = createPinia();
    const wrapper = mountRail(pinia);
    await flushPromises();
    const store = useExternalSessionsStore();
    const rightPanel = useRightPanelStore();

    await wrapper.find('[data-testid="rail-endpoint-claude"]').trigger("click");
    await flushPromises();
    expect(store.clientFilter).toBe("claude");
    expect(rightPanel.hasKind("external")).toBe(true);
    expect(rightPanel.activeTab?.kind).toBe("external");

    await wrapper.find('[data-testid="rail-endpoint-claude"]').trigger("click");
    await flushPromises();
    expect(store.clientFilter).toBe("all");
    expect(rightPanel.activeTab?.kind).toBe("external");

    wrapper.unmount();
  });

  it("已安装但没有会话的客户端仍可点（区分「未安装」与「无会话」）", async () => {
    stubZen(async () => result());
    const wrapper = mountRail();
    await flushPromises();

    const codex = wrapper.find('[data-testid="rail-endpoint-codex"]');
    expect(codex.attributes("disabled")).toBeUndefined();
    expect(codex.attributes("aria-label")).toContain("0");

    wrapper.unmount();
  });
});
