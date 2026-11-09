import { shallowMount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import RightPanel from "@/components/right/RightPanel.vue";
import { useRightPanelStore } from "@/stores/right-panel";

vi.mock("@/composables/useBrowserOverlayGuard", () => ({ useBrowserOverlayGuard: vi.fn() }));
vi.mock("@/stores/chat", () => ({ useChatStore: () => ({ sessionWorkspaceId: "" }) }));
vi.mock("@/stores/browser", () => ({ useBrowserStore: () => ({ status: { pip: false, pipHidden: false } }) }));
vi.mock("@/stores/git", () => ({ useGitStore: () => ({ loading: false }) }));

describe("RightPanel tabs", () => {
  it("让同一圆角容器独占 hover/选中背景，保留键盘切换与关闭按钮", async () => {
    const panel = useRightPanelStore();
    panel.ensureTab("errors");
    const wrapper = shallowMount(RightPanel, {
      global: { stubs: { Button: false, Primitive: false } },
    });
    const tabs = wrapper.findAll('[role="tab"]');
    const inactive = tabs[0].element.parentElement;
    const active = tabs[1].element.parentElement;

    expect(inactive?.className).toContain("hover:bg-[var(--color-menu-hover)]");
    expect(active?.className).toContain("bg-[var(--color-menu-active)]");
    expect(active?.className).toContain("hover:bg-[var(--color-menu-active)]");
    expect(tabs[1].classes()).toContain("hover:bg-transparent!");
    expect(tabs[1].classes()).not.toContain("bg-[var(--color-menu-active)]");
    const close = wrapper.get('[role="tablist"] > div:nth-child(2) button[aria-label]');
    expect(close.element.parentElement).toBe(active);
    expect(close.classes()).toContain("hover:bg-transparent!");
    expect(wrapper.get("header").attributes("class")).toContain("[-webkit-app-region:drag]");
    expect(wrapper.get("header").attributes("class")).toContain("[&_button]:[-webkit-app-region:no-drag]");

    await tabs[1].trigger("keydown", { key: "ArrowLeft" });
    expect(panel.activeId).toBe("files");
    await close.trigger("click");
    expect(panel.tabs.map((tab) => tab.id)).toEqual(["files"]);
    wrapper.unmount();
  });
});
