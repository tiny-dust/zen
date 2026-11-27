import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import AppSidebar from "@/components/sidebar/AppSidebar.vue";
import { i18n } from "@/locales";

import type { SessionRecord } from "@zen/shared";

const archivedSession: SessionRecord = {
  id: "s-arch",
  title: "已归档的会话",
  workspaceId: "ws-1",
  draft: "",
  pinned: false,
  archived: true,
  createdAt: 1,
  updatedAt: 5,
};

const removedWorkspace = {
  id: "ws-gone",
  name: "归档的项目",
  kind: "workspace" as const,
  path: "/tmp/gone",
  archived: true,
  pinned: false,
  createdAt: 2,
  sessions: [],
};

function zenMock() {
  return {
    shell: { platformInfo: async () => ({}) },
    workspace: {
      list: async () => [
        { id: "common", name: "公共区", kind: "common", archived: false, pinned: false, sessions: [] },
        {
          id: "ws-1",
          name: "项目一",
          kind: "workspace",
          path: "/tmp/ws1",
          archived: false,
          pinned: false,
          // 每次返回浅拷贝：store 会把 archived 改回 false，共享同一个对象会污染后续用例
          sessions: [{ ...archivedSession }],
        },
        removedWorkspace,
      ],
      create: async () => [],
      pin: async () => [],
      rename: async () => [],
      archive: vi.fn(async () => []),
      remove: async () => [],
    },
    session: {
      open: async () => ({ session: archivedSession, messages: [] }),
      create: async () => archivedSession,
      rename: async () => {},
      setDraft: async () => {},
      archive: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
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
}

async function mountSidebar(zen: ReturnType<typeof zenMock>) {
  // 直接挂到真实 window 上：替换整个 window 会丢掉 Event 构造函数，trigger 会炸
  (window as unknown as { zen: unknown }).zen = zen;
  const wrapper = mount(AppSidebar, {
    global: {
      plugins: [createPinia(), i18n],
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
    attachTo: document.body,
  });
  await flushPromises();
  // refresh 拉一次侧栏数据（归档会话与归档工作区都来自这里）
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("AppSidebar 已归档分区", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("归档分区同时列出归档会话与归档工作区", async () => {
    const zen = zenMock();
    const wrapper = await mountSidebar(zen);
    const workspace = (await import("@/stores/workspace")).useWorkspaceStore();
    await workspace.refresh();
    await flushPromises();

    expect(wrapper.text()).toContain("已归档");
    expect(wrapper.text()).toContain("已归档的会话");
    expect(wrapper.text()).toContain("归档的项目");
    wrapper.unmount();
  });

  it("恢复归档会话调用 archive(id, false)，恢复后不再留在归档区", async () => {
    const zen = zenMock();
    const wrapper = await mountSidebar(zen);
    const workspace = (await import("@/stores/workspace")).useWorkspaceStore();
    await workspace.refresh();
    await flushPromises();

    const restore = wrapper.find('button[aria-label="恢复"]');
    expect(restore.exists()).toBe(true);
    await restore.trigger("click");
    await flushPromises();
    expect(zen.session.archive).toHaveBeenCalledWith(archivedSession.id, false);
    await flushPromises();
    await wrapper.vm.$nextTick();
    // 会话那一行的「恢复」消失（回到项目分组），归档工作区的恢复入口还在
    expect(wrapper.find('button[aria-label="恢复"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="恢复工作区"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("归档区的删除仍要二次确认", async () => {
    const zen = zenMock();
    const wrapper = await mountSidebar(zen);
    const workspace = (await import("@/stores/workspace")).useWorkspaceStore();
    await workspace.refresh();
    await flushPromises();

    await wrapper.find('button[aria-label="删除会话"]').trigger("click");
    await flushPromises();
    const dialog = wrapper.findAllComponents(ConfirmDialog)[0]!;
    expect(zen.session.remove).not.toHaveBeenCalled();
    dialog.vm.$emit("confirm");
    await flushPromises();
    expect(zen.session.remove).toHaveBeenCalledWith(archivedSession.id);
    wrapper.unmount();
  });

  it("恢复归档工作区调用 workspace.archive(id, false)", async () => {
    const zen = zenMock();
    const wrapper = await mountSidebar(zen);
    const workspace = (await import("@/stores/workspace")).useWorkspaceStore();
    await workspace.refresh();
    await flushPromises();

    await wrapper.find('button[aria-label="恢复工作区"]').trigger("click");
    expect(zen.workspace.archive).toHaveBeenCalledWith(removedWorkspace.id, false);
    wrapper.unmount();
  });
});
