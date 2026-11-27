import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AppTitlebar from "@/components/topbar/AppTitlebar.vue";
import { i18n } from "@/locales";
import { NAV_RAIL_W, useLayoutStore } from "@/stores/layout";
import { useWorkbenchPageStore } from "@/stores/workbench-page";

vi.mock("@/stores/chat", () => ({ useChatStore: () => ({ newTask: vi.fn() }) }));
vi.mock("@/stores/terminal", () => ({ useTerminalStore: () => ({ ensureForWorkspace: vi.fn() }) }));

function mountBar() {
  return mount(AppTitlebar, {
    props: { isWide: true },
    global: {
      plugins: [i18n],
      stubs: {
        Button: { template: "<button v-bind=\"$attrs\"><slot /></button>" },
        SessionSwitcher: true,
        SystemInfoButton: true,
        OpenWithButton: true,
        TranscriptViewMenu: true,
        RightPanelTabs: true,
        WindowControls: true,
      },
    },
  });
}

describe("AppTitlebar 三段与下方分栏对齐", () => {
  it("左段宽度 = 轨道 + 会话面板，右段宽度 = 右栏宽度", () => {
    const layout = useLayoutStore();
    const wrapper = mountBar();

    const left = wrapper.get('[data-zone="left"]');
    const right = wrapper.get('[data-zone="right"]');
    expect(left.attributes("style")).toContain(`width: ${NAV_RAIL_W + layout.panelWidth}px`);
    expect(right.attributes("style")).toContain(`width: ${layout.rightWidth}px`);

    wrapper.unmount();
  });

  it("右栏收起时不留右段，只留原生窗口按钮占位", () => {
    const layout = useLayoutStore();
    layout.toggleRight();
    const wrapper = mountBar();

    expect(wrapper.find('[data-zone="right"]').exists()).toBe(false);
    expect(wrapper.find('[data-zone="left"]').exists()).toBe(true);
    expect(wrapper.find('[data-zone="center"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("会话面板收起时左段只剩轨道宽度", () => {
    const layout = useLayoutStore();
    layout.toggleLeft();
    const wrapper = mountBar();

    expect(wrapper.get('[data-zone="left"]').attributes("style")).toContain(`width: ${NAV_RAIL_W}px`);

    wrapper.unmount();
  });

  it("整页模式下不渲染右栏标签段", () => {
    useWorkbenchPageStore().open("skills");
    const wrapper = mountBar();

    expect(wrapper.find('[data-zone="right"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("中段两端对齐：标题在左组，会话操作在右组", () => {
    const wrapper = mountBar();
    const t = i18n.global.t;

    const center = wrapper.get('[data-zone="center"]');
    expect(center.classes()).toContain("justify-between");

    const left = wrapper.get('[data-zone="center-left"]');
    const actions = wrapper.get('[data-zone="center-actions"]');
    // 左组贴内容区左边界：会话名可下拉
    expect(left.find("session-switcher-stub").exists()).toBe(true);
    // 右组贴内容区右边界：新建/会话信息/在 App 打开/终端/转录视图
    expect(actions.find(`button[aria-label="${t("shell.newChat")}"]`).exists()).toBe(true);
    expect(actions.find(`button[aria-label="${t("shell.terminal")}"]`).exists()).toBe(true);

    // 顺序：左组在前、操作组在后，中间没有别的同级节点
    expect(center.element.firstElementChild).toBe(left.element);
    expect(center.element.lastElementChild).toBe(actions.element);

    wrapper.unmount();
  });

  it("窄窗口不重叠：标题缩略、操作组不收缩", () => {
    const wrapper = mountBar();

    expect(wrapper.get('[data-zone="center-left"]').classes()).toContain("min-w-0");
    expect(wrapper.get('[data-zone="center-actions"]').classes()).toContain("flex-none");

    wrapper.unmount();
  });

  it("整页模式同样左对齐，右侧没有操作组", () => {
    useWorkbenchPageStore().open("skills");
    const wrapper = mountBar();

    const center = wrapper.get('[data-zone="center"]');
    expect(center.classes()).toContain("justify-between");
    expect(wrapper.get('[data-zone="center-left"]').text()).toBe(i18n.global.t("sidebar.skills"));
    expect(wrapper.find('[data-zone="center-actions"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
