import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppSidebar from "./AppSidebar.vue";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord } from "@zen/shared";

const sessionA: SessionRecord = {
  id: "s-a",
  title: "已完成的会话 A",
  workspaceId: "ws-1",
  draft: "",
  pinned: false,
  archived: false,
  createdAt: 1,
  updatedAt: 2,
};
const sessionB: SessionRecord = {
  id: "s-b",
  title: "会话 B",
  workspaceId: "ws-1",
  draft: "",
  pinned: false,
  archived: false,
  createdAt: 3,
  updatedAt: 4,
};

const zenMock = {
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
        sessions: [sessionA, sessionB],
      },
    ],
    create: async () => [],
    pin: async () => [],
    rename: async () => [],
    archive: async () => [],
    remove: async () => [],
  },
  session: {
    open: async (id: string) => ({
      session: { ...(id === "s-a" ? sessionA : sessionB), title: id === "s-a" ? sessionA.title : sessionB.title },
      messages: [],
    }),
    create: async () => sessionB,
    rename: async () => {},
    setDraft: async () => {},
  },
  app: { info: async () => ({ workspaceRoot: "" }) },
  git: { info: async () => ({ repo: "", branch: "" }), status: async () => ({}) },
  agent: { onEvent: () => () => undefined, getSettings: async () => ({}), promptPresets: async () => [], listSkills: async () => [], sandboxDir: async () => "" },
};

function activeTitles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[aria-current="true"]')
    .map((row) => row.find("span").text());
}

/** 选中底色 class：才是真实视觉高亮（aria-current 响应式正常不代表 class 正常） */
function selRowTitles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll(".group\\/session")
    .filter((row) => row.classes().includes("bg-[var(--color-side-sel)]"))
    .map((row) => row.find("span").text());
}

describe("AppSidebar 会话激活高亮", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("window", { ...window, zen: zenMock });
    localStorage.clear();
  });

  it("启动时未点击任何会话：无高亮行", async () => {
    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [createPinia()],
        stubs: { UserBlock: true, SkillsDialog: true, McpDialog: true, Dialog: true, DialogContent: true, ConfirmDialog: true, teleport: true },
      },
      attachTo: document.body,
    });
    await flushPromises();

    expect(activeTitles(wrapper)).toEqual([]);
    wrapper.unmount();
  });

  it("点击会话 B 后高亮从 A 迁移到 B", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(AppSidebar, {
      global: {
        plugins: [pinia],
        stubs: { UserBlock: true, SkillsDialog: true, McpDialog: true, Dialog: true, DialogContent: true, ConfirmDialog: true, teleport: true },
      },
      attachTo: document.body,
    });
    await flushPromises();

    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await flushPromises();

    // 模拟用户先前点击过会话 A（高亮在 A）
    await chat.loadSession(sessionA);
    await flushPromises();
    expect(activeTitles(wrapper)).toEqual(["已完成的会话 A"]);
    expect(selRowTitles(wrapper)).toEqual(["已完成的会话 A"]);

    // 手动点击会话 B
    const rowB = wrapper.findAll("button").find((btn) => btn.text() === "会话 B");
    expect(rowB).toBeTruthy();
    await rowB!.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(chat.sessionId).toBe("s-b");
    expect(workspace.activeId).toBe("ws-1");
    expect(activeTitles(wrapper)).toEqual(["会话 B"]);
    // 关键断言：视觉高亮 class 必须跟着点击迁移，旧会话底色清除
    expect(selRowTitles(wrapper)).toEqual(["会话 B"]);
    wrapper.unmount();
  });
});
