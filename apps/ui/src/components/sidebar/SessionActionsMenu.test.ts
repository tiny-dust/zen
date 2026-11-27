import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SessionActionsMenu from "@/components/sidebar/SessionActionsMenu.vue";
import { i18n } from "@/locales";

import type { SessionRecord } from "@zen/shared";

const base: SessionRecord = {
  id: "s-1",
  title: "会话一",
  workspaceId: "ws-1",
  draft: "",
  pinned: false,
  archived: false,
  createdAt: 1,
  updatedAt: 2,
};

function mountMenu(props: { session?: SessionRecord; canFork?: boolean } = {}) {
  return mount(SessionActionsMenu, {
    props: {
      session: props.session ?? base,
      x: 40,
      y: 40,
      canFork: props.canFork ?? true,
    },
    global: { plugins: [i18n], stubs: { teleport: true } },
    attachTo: document.body,
  });
}

describe("SessionActionsMenu 会话操作菜单", () => {
  it("列出重命名 / 分叉 / 置顶 / 导出 / 归档 / 删除", () => {
    const wrapper = mountMenu();
    const labels = wrapper.findAll('[role="menuitem"]').map((item) => item.text());

    expect(labels).toEqual(["重命名会话", "分叉会话", "置顶", "导出会话", "归档", "删除会话"]);
    wrapper.unmount();
  });

  it("运行中的会话禁用分叉并给出原因", () => {
    const wrapper = mountMenu({ canFork: false });
    const fork = wrapper.findAll('[role="menuitem"]')[1]!;

    expect(fork.attributes("disabled")).toBeDefined();
    expect(fork.attributes("title")).toContain("正在运行");
    wrapper.unmount();
  });

  it("归档项按当前状态取反，删除走独立事件", async () => {
    const wrapper = mountMenu({ session: { ...base, pinned: true, archived: true } });

    await wrapper.findAll('[role="menuitem"]')[4]!.trigger("click");
    expect(wrapper.emitted("archive")?.[0]).toEqual([false]);

    await wrapper.findAll('[role="menuitem"]')[5]!.trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
    wrapper.unmount();
  });

  it("Escape 收起菜单", async () => {
    const wrapper = mountMenu();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
});
