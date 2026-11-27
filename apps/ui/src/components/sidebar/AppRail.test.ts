import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/locales";

import { NAV_RAIL_W } from "@/stores/layout";
import { useWorkbenchPageStore } from "@/stores/workbench-page";

import AppRail from "./AppRail.vue";

const zenMock = {
  agent: { listSkills: async () => [] },
  mcp: { list: async () => [] },
};

const t = i18n.global.t;

function mountRail(pinia = createPinia()) {
  setActivePinia(pinia);
  return mount(AppRail, {
    global: {
      plugins: [i18n, pinia],
      stubs: { UserBlock: true, CollapsedSessionPeek: true, ExternalEndpointRail: true },
    },
  });
}

describe("AppRail 分类轨道", () => {
  beforeEach(() => {
    // 直接挂 zen mock：整体 stub window 会丢掉 Event 构造器，trigger 会失败
    (window as unknown as { zen?: unknown }).zen = zenMock;
    localStorage.clear();
  });

  it("按顺序渲染分类入口（对话在前，工具在后）", async () => {
    const wrapper = mountRail();
    await flushPromises();

    const labels = wrapper.findAll("button[aria-label]").map((el) => el.attributes("aria-label") ?? "");
    const expected = [
      t("sidebar.backToChat"),
      t("shell.fleetBoard"),
      t("sidebar.zoneTasks"),
      t("sidebar.skills"),
      "MCP",
      t("features.entry"),
      t("sidebar.activity"),
    ];
    expect(labels.filter((label) => expected.includes(label))).toEqual(expected);

    wrapper.unmount();
  });

  it("点分类在内容区切页（不是弹窗），再点同一个回到对话", async () => {
    const wrapper = mountRail();
    await flushPromises();
    const pageStore = useWorkbenchPageStore();

    await wrapper.find(`button[aria-label="${t("sidebar.skills")}"]`).trigger("click");
    expect(pageStore.page).toBe("skills");

    await wrapper.find(`button[aria-label="${t("sidebar.skills")}"]`).trigger("click");
    expect(pageStore.page).toBe("chat");

    wrapper.unmount();
  });

  it("账户入口固定在轨道底部", async () => {
    const wrapper = mountRail();
    await flushPromises();
    expect(wrapper.find('[data-testid="rail-account"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("轨道宽 52px、图标 18px（对齐 nomi 的 .rail）", async () => {
    const wrapper = mountRail();
    await flushPromises();

    expect(NAV_RAIL_W).toBe(52);
    const rail = wrapper.get('[data-testid="app-rail"]');
    expect(rail.attributes("style")).toContain(`width: ${NAV_RAIL_W}px`);

    for (const label of [t("sidebar.backToChat"), t("sidebar.skills"), t("sidebar.activity")]) {
      const icon = wrapper.get(`button[aria-label="${label}"] svg`);
      expect(icon.attributes("width")).toBe("18");
      expect(icon.attributes("height")).toBe("18");
    }

    wrapper.unmount();
  });

  it("分类入口与第三方 Agent 之间有一条分隔线，端点组紧随其后", async () => {
    const wrapper = mountRail();
    await flushPromises();

    const divider = wrapper.get('[data-testid="rail-divider"]');
    // 端点组是 stub，分隔线必须紧贴它（分类组末尾与端点组开头之间）
    expect(divider.element.nextElementSibling?.outerHTML ?? "").toContain("external-endpoint");

    wrapper.unmount();
  });
});
