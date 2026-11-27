import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/locales";
import { useWorkspaceStore } from "@/stores/workspace";

import CollapsedSessionPeek from "./CollapsedSessionPeek.vue";

import type { WorkspaceGroup } from "@zen/shared";

const GROUPS: WorkspaceGroup[] = [
  {
    id: "w1",
    name: "zen",
    kind: "workspace",
    archived: false,
    pinned: false,
    createdAt: 10,
    path: "/repo/zen",
    sessions: [
      {
        id: "s1",
        title: "较新的会话",
        workspaceId: "w1",
        archived: false,
        pinned: false,
        draft: "",
        createdAt: 150,
        updatedAt: 200,
      },
      {
        id: "s2",
        title: "较旧的会话",
        workspaceId: "w1",
        archived: false,
        pinned: false,
        draft: "",
        createdAt: 50,
        updatedAt: 100,
      },
    ],
  },
];

function mountPeek() {
  return mount(CollapsedSessionPeek, {
    global: { plugins: [i18n], stubs: { teleport: true } },
  });
}

describe("收起侧栏的会话浮层", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = useWorkspaceStore();
    store.groups = GROUPS;
    (window as unknown as { zen: unknown }).zen = {
      session: { open: async () => ({ session: {}, messages: [] }) },
    };
  });

  it("按最近活动排序，折叠/归档不出现", async () => {
    const wrapper = mountPeek();
    await wrapper.find('[data-testid="rail-session-peek-trigger"]').trigger("click");
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="rail-session-peek"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain("较新的会话");

    wrapper.unmount();
  });

  it("点触发按钮打开浮层，Esc 关闭", async () => {
    const wrapper = mountPeek();
    const trigger = wrapper.find('[data-testid="rail-session-peek-trigger"]');
    await trigger.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="rail-session-peek"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(wrapper.find('[data-testid="rail-session-peek"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
