import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CuaSection from "@/components/settings/sections/CuaSection.vue";
import { useAgentStore } from "@/stores/agent";

let pinia: ReturnType<typeof createPinia>;
const openExternal = vi.fn();

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  useAgentStore().settings.cuaEnabled = true;
  vi.stubGlobal("zen", { app: { openExternal } });
  vi.stubGlobal("navigator", { userAgent: "Macintosh" });
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  openExternal.mockReset();
});

describe("CuaSection Accessibility settings", () => {
  it("opens the macOS Accessibility pane", async () => {
    openExternal.mockResolvedValue({ ok: true });
    const wrapper = mount(CuaSection, { global: { plugins: [pinia] } });
    await wrapper.findAll("button").find((button) => button.text().includes("打开系统辅助功能授权"))!.trigger("click");
    await flushPromises();
    expect(openExternal).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a fallback when the system rejects the link", async () => {
    openExternal.mockResolvedValue({ ok: false });
    const wrapper = mount(CuaSection, { global: { plugins: [pinia] } });
    await wrapper.findAll("button").find((button) => button.text().includes("打开系统辅助功能授权"))!.trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("系统设置");
    wrapper.unmount();
  });
});
