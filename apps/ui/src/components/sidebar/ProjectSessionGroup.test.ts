import { mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ProjectSessionGroup from "@/components/sidebar/ProjectSessionGroup.vue";

import type { VueWrapper } from "@vue/test-utils";
import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

function sessionOf(id: string, title: string): SessionRecord {
  return {
    id,
    title,
    workspaceId: "ws-1",
    draft: "",
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

function groupOf(patch: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return {
    id: "ws-1",
    name: "项目一",
    path: "/tmp/ws1",
    kind: "workspace",
    pinned: false,
    archived: false,
    createdAt: 1,
    sessions: [],
    ...patch,
  };
}

function mountGroup(props: {
  group?: WorkspaceGroup;
  sessions?: SessionRecord[];
  open?: boolean;
  expanded?: boolean;
} = {}): VueWrapper {
  return mount(ProjectSessionGroup, {
    props: {
      group: props.group ?? groupOf(),
      sessions: props.sessions ?? [],
      open: props.open ?? true,
      expanded: props.expanded ?? true,
      activeSessionId: "s-1",
      showInFolderLabel: "在访达中显示",
      ...{},
    },
    global: {
      plugins: [pinia],
      stubs: {
        // 右键菜单内容经传送门渲染，桩成常驻 DOM 便于触发 select
        ContextMenu: { template: "<div><slot /></div>" },
        ContextMenuTrigger: { template: "<div><slot /></div>" },
        ContextMenuContent: { template: "<div class='menu'><slot /></div>" },
        ContextMenuItem: {
          template: "<div class='menu-item' @click=\"$emit('select')\"><slot /></div>",
        },
        ContextMenuSeparator: true,
        SessionRow: {
          name: "SessionRow",
          props: ["session", "active"],
          emits: ["open", "pin", "archive", "remove"],
          template: "<div class='session-row' @click=\"$emit('open')\">{{ session.title }}</div>",
        },
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
});

describe("ProjectSessionGroup 组头与快捷操作", () => {
  it("common 组只显示新建会话，不显示置顶/删除工作区", async () => {
    const wrapper = mountGroup({ group: groupOf({ kind: "common", name: "公共区", path: null }) });

    expect(wrapper.text()).toContain("公共区");
    expect(wrapper.find('button[aria-label="新建会话"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="置顶"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="删除工作区"]').exists()).toBe(false);

    await wrapper.find('button[aria-label="新建会话"]').trigger("click");
    expect(wrapper.emitted("new-session")).toHaveLength(1);
    wrapper.unmount();
  });

  it("工作区组显示置顶/删除按钮并转发事件", async () => {
    const wrapper = mountGroup({ group: groupOf({ pinned: false }) });

    const pinButton = wrapper.find('button[aria-label="置顶"]');
    expect(pinButton.exists()).toBe(true);
    await pinButton.trigger("click");
    expect(wrapper.emitted("pin-workspace")).toHaveLength(1);

    await wrapper.find('button[aria-label="删除工作区"]').trigger("click");
    expect(wrapper.emitted("delete-workspace")).toHaveLength(1);
    wrapper.unmount();
  });

  it("已置顶的组显示取消置顶文案", async () => {
    const wrapper = mountGroup({ group: groupOf({ pinned: true }) });

    const button = wrapper.find('button[aria-label="取消置顶"]');
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    expect(wrapper.emitted("pin-workspace")).toHaveLength(1);
    wrapper.unmount();
  });

  it("点击组头转发 toggle 事件", async () => {
    const wrapper = mountGroup();

    await wrapper.find('button[aria-label="项目一"]').trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("ProjectSessionGroup 会话列表截断与展开", () => {
  const sessions = Array.from({ length: 8 }, (_, i) => sessionOf(`s-${i}`, `会话 ${i}`));

  it("未展开时截断显示 5+1 条并展示展开按钮", () => {
    const wrapper = mountGroup({ sessions, expanded: false });

    const rows = wrapper.findAll(".session-row");
    // PREVIEW_COUNT=5，多渲染 1 条露头
    expect(rows).toHaveLength(6);
    expect(wrapper.find(".session-list-fade").exists()).toBe(true);
    expect(wrapper.text()).toContain("展开显示");
    wrapper.unmount();
  });

  it("展开后显示全部会话，收起按钮转发 toggle-expand", async () => {
    const wrapper = mountGroup({ sessions, expanded: true });

    expect(wrapper.findAll(".session-row")).toHaveLength(8);
    expect(wrapper.find(".session-list-fade").exists()).toBe(false);

    await wrapper.findAll("button").find((b) => b.text().trim() === "收起")!.trigger("click");
    expect(wrapper.emitted("toggle-expand")).toHaveLength(1);
    wrapper.unmount();
  });

  it("会话数不超过预览数时不显示展开按钮", () => {
    const wrapper = mountGroup({
      sessions: sessions.slice(0, 4),
      expanded: false,
    });

    expect(wrapper.findAll(".session-row")).toHaveLength(4);
    expect(wrapper.findAll("button").some((b) => b.text().trim() === "展开显示")).toBe(false);
    wrapper.unmount();
  });

  it("折叠的组不渲染会话列表", () => {
    const wrapper = mountGroup({ sessions, open: false });

    expect(wrapper.findAll(".session-row")).toHaveLength(0);
    wrapper.unmount();
  });

  it("SessionRow 事件转发为带会话载荷的 open/pin/archive/remove", async () => {
    const wrapper = mountGroup({ sessions: sessions.slice(0, 2) });

    const row = wrapper.find(".session-row");
    await row.trigger("click");
    expect(wrapper.emitted("open")?.[0]).toEqual([sessions[0]]);

    const stub = wrapper.findComponent({ name: "SessionRow" });
    stub.vm.$emit("pin");
    stub.vm.$emit("archive", true);
    stub.vm.$emit("remove");
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("pin")?.[0]).toEqual([sessions[0]]);
    expect(wrapper.emitted("archive")?.[0]).toEqual([sessions[0], true]);
    expect(wrapper.emitted("remove")?.[0]).toEqual([sessions[0]]);
    wrapper.unmount();
  });
});

describe("ProjectSessionGroup 右键菜单", () => {
  it("common 组菜单只有新建会话", async () => {
    const wrapper = mountGroup({ group: groupOf({ kind: "common", name: "公共区", path: null }) });

    const items = wrapper.findAll(".menu-item");
    expect(items).toHaveLength(1);
    await items[0]!.trigger("click");
    expect(wrapper.emitted("new-session")).toHaveLength(1);
    wrapper.unmount();
  });

  it("工作区组菜单转发置顶/重命名/复制路径/显示/删除事件", async () => {
    const wrapper = mountGroup({ group: groupOf({ pinned: true }) });

    const items = wrapper.findAll(".menu-item");
    // 新建会话 / 取消置顶 / 重命名 / 复制路径 / 显示 / 删除工作区
    expect(items).toHaveLength(6);
    expect(wrapper.text()).toContain("在访达中显示");
    expect(wrapper.text()).toContain("取消置顶");

    await items[1]!.trigger("click"); // 取消置顶
    await items[2]!.trigger("click"); // 重命名
    await items[3]!.trigger("click"); // 复制路径
    await items[4]!.trigger("click"); // 在访达中显示
    await items[5]!.trigger("click"); // 删除工作区

    expect(wrapper.emitted("pin-workspace")).toHaveLength(1);
    expect(wrapper.emitted("rename")).toHaveLength(1);
    expect(wrapper.emitted("copy-path")).toHaveLength(1);
    expect(wrapper.emitted("show-in-folder")).toHaveLength(1);
    expect(wrapper.emitted("delete-workspace")).toHaveLength(1);
    wrapper.unmount();
  });
});
