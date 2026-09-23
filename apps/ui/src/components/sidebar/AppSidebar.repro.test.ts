import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi, beforeEach } from "vitest";

import AppSidebar from "./AppSidebar.vue";
import { useWorkspaceStore } from "@/stores/workspace";

const createWorkspace = vi.fn(async () => ({
  id: "ws-new",
  name: "New",
  kind: "workspace",
  archived: false,
  pinned: false,
  sessions: [],
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", {
    ...window,
    zen: {
      shell: { platformInfo: async () => ({}) },
      workspace: {
        list: async () => [
          { id: "common", name: "公共区", kind: "common", archived: false, pinned: false, sessions: [] },
          ...(createWorkspace.mock.calls.length
            ? [{ id: "ws-new", name: "New", kind: "workspace", archived: false, pinned: false, sessions: [] }]
            : []),
        ],
        create: createWorkspace,
        pin: async (id: string, p: boolean) => [],
        rename: async () => [],
        archive: async () => [],
        remove: async () => [],
      },
      session: {},
    },
  });
});

describe("AppSidebar 新建工作区", () => {
  it("点击区块头「新建工作区」按钮应触发 workspace.create", async () => {
    const pinia = createPinia();
    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [pinia],
        stubs: {
          ProjectSessionGroup: true,
          UserBlock: true,
          SkillsDialog: true,
          McpDialog: true,
          Dialog: true,
          DialogContent: true,
          ConfirmDialog: true,
          teleport: true,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();

    const store = useWorkspaceStore();
    const btn = wrapper.find('button[aria-label="新建工作区"]');
    expect(btn.exists()).toBe(true);
    (btn.element as HTMLButtonElement).click();
    await flushPromises();

    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(store.groups.some((g) => g.id === "ws-new")).toBe(true);
    wrapper.unmount();
  });

  it("workspace.create 被 reject 时应 console.error 并返回 false（不再静默）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createWorkspace.mockRejectedValueOnce(new Error("dialog TypeError"));
    const store = useWorkspaceStore();
    const result = await store.create();
    await flushPromises();

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("[workspace] create failed:", expect.any(Error));
    errorSpy.mockRestore();
  });
});
