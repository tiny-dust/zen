import { shallowMount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import RightPanel from "@/components/right/RightPanel.vue";
import { useRightPanelStore } from "@/stores/right-panel";

vi.mock("@/stores/chat", () => ({ useChatStore: () => ({ sessionWorkspaceId: "" }) }));
vi.mock("@/stores/browser", () => ({ useBrowserStore: () => ({ status: { pip: false, pipHidden: false }, syncStatus: vi.fn(), reconcileView: vi.fn() }) }));

describe("RightPanel 面板本体", () => {
  it("只渲染当前标签的内容，不再重复标签条", async () => {
    const panel = useRightPanelStore();
    panel.ensureTab("errors");
    const wrapper = shallowMount(RightPanel);
    const content = wrapper.get('[role="tabpanel"]');

    expect(content.attributes("id")).toBe(`panel-content-${panel.activeId}`);
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(wrapper.find("#panel-content-errors").exists()).toBe(true);

    wrapper.unmount();
  });
});
