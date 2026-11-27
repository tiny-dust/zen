import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/locales";

import { useLayoutStore } from "@/stores/layout";

import AppSidebar from "./AppSidebar.vue";

/**
 * 侧栏 n4 结构：52px 常驻导航轨道（图标入口）+ 可收起的会话面板。
 * 入口只允许出现在轨道里一次，面板只放搜索与分组，避免同一功能两处可点。
 */
const zenMock = {
  shell: { platformInfo: async () => ({}) },
  workspace: {
    list: async () => [
      { id: "common", name: "公共区", kind: "common", archived: false, pinned: false, sessions: [] },
    ],
    create: async () => [],
    pin: async () => [],
    rename: async () => [],
    archive: async () => [],
    remove: async () => [],
  },
  session: { open: async () => ({ session: {}, messages: [] }), create: async () => ({}) },
  app: { info: async () => ({ workspaceRoot: "" }) },
  git: { info: async () => ({ repo: "", branch: "" }), status: async () => ({}) },
  agent: {
    onEvent: () => () => undefined,
    getSettings: async () => ({}),
    promptPresets: async () => [],
    listSkills: async () => [],
    sandboxDir: async () => "",
  },
  mcp: { list: async () => [] },
};

function mountSidebar(pinia = createPinia()) {
  return mount(AppSidebar, {
    global: {
      plugins: [pinia, i18n],
      stubs: {
        UserBlock: true,
        SkillsDialog: true,
        McpDialog: true,
        SchedulerDialog: true,
        FeaturesDialog: true,
        Dialog: true,
        DialogContent: true,
        ConfirmDialog: true,
        teleport: true,
      },
    },
  });
}

const t = i18n.global.t;

describe("AppSidebar 会话面板", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("window", { ...window, zen: zenMock });
    localStorage.clear();
  });

  it("面板只承载搜索与分组，不含分类入口", async () => {
    const wrapper = mountSidebar();
    await flushPromises();

    expect(wrapper.find(`input[aria-label="${t("sidebar.searchSessions")}"]`).exists()).toBe(true);
    // 分类入口一律在 52px 轨道（AppRail），面板里不再重复
    const labels = wrapper.findAll("button[aria-label]").map((el) => el.attributes("aria-label") ?? "");
    for (const label of [t("scheduler.entry"), t("sidebar.activity"), t("sidebar.skills"), t("features.entry")]) {
      expect(labels).not.toContain(label);
    }

    wrapper.unmount();
  });

  it("账户入口不再出现在面板里（已移到轨道底部）", async () => {
    const wrapper = mountSidebar();
    await flushPromises();
    expect(wrapper.find('[data-testid="rail-account"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
