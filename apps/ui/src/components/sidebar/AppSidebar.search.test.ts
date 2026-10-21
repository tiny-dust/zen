import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppSidebar from "./AppSidebar.vue";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord } from "@zen/shared";

/** 归属公共区的命中会话（workspaceId=null） */
const commonHit: SessionRecord = {
  id: "s-hit",
  title: "Vue 调试记录",
  workspaceId: null,
  draft: "",
  pinned: false,
  archived: false,
  createdAt: 1,
  updatedAt: 2,
};
/** 归属工作区 ws-1 的命中会话（验证组名小字） */
const workspaceHit: SessionRecord = {
  ...commonHit,
  id: "s-hit-ws",
  title: "项目里的泛型讨论",
  workspaceId: "ws-1",
};

const search = vi.fn(async () => [workspaceHit, commonHit]);

const zenMock = {
  shell: { platformInfo: async () => ({}) },
  workspace: {
    list: async () => [
      { id: "common", name: "公共区", kind: "common", archived: false, pinned: false, sessions: [commonHit] },
      {
        id: "ws-1",
        name: "项目一",
        kind: "workspace",
        path: "/tmp/ws1",
        archived: false,
        pinned: false,
        sessions: [workspaceHit],
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
      session: { ...(id === "s-hit" ? commonHit : workspaceHit) },
      messages: [],
    }),
    create: async () => workspaceHit,
    search,
    rename: async () => {},
    setDraft: async () => {},
  },
  app: { info: async () => ({ workspaceRoot: "" }) },
  git: { info: async () => ({ repo: "", branch: "" }), status: async () => ({}) },
  agent: { onEvent: () => () => undefined, getSettings: async () => ({}), promptPresets: async () => [], listSkills: async () => [], sandboxDir: async () => "" },
};

/** 等过 200ms 防抖窗口再 flush 微任务 */
async function settleDebounce() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  await flushPromises();
}

async function mountSidebar() {
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
  const workspace = useWorkspaceStore();
  await workspace.refresh();
  await flushPromises();
  return wrapper;
}

describe("AppSidebar 会话搜索", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("zen", zenMock);
    search.mockClear();
    localStorage.clear();
  });

  it("输入关键词：会话区切换为结果列表，显示标题与所属组名小字", async () => {
    const wrapper = await mountSidebar();

    const input = wrapper.find('input[aria-label="搜索会话"]');
    expect(input.exists()).toBe(true);
    await input.setValue("调试");
    await settleDebounce();

    expect(search).toHaveBeenCalledWith("调试", 30);
    // 原分区隐藏（公共区/工作区组头消失），搜索结果出现
    expect(wrapper.text()).not.toContain("工作区");
    expect(wrapper.text()).toContain("Vue 调试记录");
    // 组名小字：公共区命中显示「公共区」，工作区命中显示「项目一」
    expect(wrapper.text()).toContain("项目一");
    expect(wrapper.text()).toContain("公共区");
    wrapper.unmount();
  });

  it("点击结果直接打开该会话", async () => {
    const wrapper = await mountSidebar();
    const input = wrapper.find('input[aria-label="搜索会话"]');
    await input.setValue("调试");
    await settleDebounce();

    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    const row = wrapper.findAll("button").find((btn) => btn.text().includes("Vue 调试记录"));
    expect(row).toBeTruthy();
    await row!.trigger("click");
    await flushPromises();

    expect(chat.sessionId).toBe("s-hit");
    expect(workspace.activeId).toBe("common");
    wrapper.unmount();
  });

  it("无结果显示「未找到匹配会话」", async () => {
    search.mockResolvedValueOnce([]);
    const wrapper = await mountSidebar();
    const input = wrapper.find('input[aria-label="搜索会话"]');
    await input.setValue("不存在的词");
    await settleDebounce();

    expect(wrapper.text()).toContain("未找到匹配会话");
    wrapper.unmount();
  });

  it("纯空格不触发查询，保持原会话分区", async () => {
    const wrapper = await mountSidebar();
    const input = wrapper.find('input[aria-label="搜索会话"]');
    await input.setValue("   ");
    await settleDebounce();

    expect(search).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("公共区");
    expect(wrapper.text()).toContain("工作区");
    wrapper.unmount();
  });

  it("Esc 清空关键词，恢复原会话分区", async () => {
    const wrapper = await mountSidebar();
    const input = wrapper.find('input[aria-label="搜索会话"]');
    await input.setValue("调试");
    await settleDebounce();
    expect(wrapper.text()).toContain("Vue 调试记录");

    await input.trigger("keydown", { key: "Escape" });
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("公共区");
    expect(wrapper.text()).toContain("工作区");
    wrapper.unmount();
  });
});
