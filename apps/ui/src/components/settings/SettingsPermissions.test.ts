import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPermissions from "@/components/settings/SettingsPermissions.vue";
import { useAgentStore } from "@/stores/agent";

import type { VueWrapper } from "@vue/test-utils";

let pinia: ReturnType<typeof createPinia>;

const setSettings = vi.fn();

function stubZen() {
  // setSettings 返回合并后的完整设置，模拟主进程持久化
  setSettings.mockImplementation(async (partial: Record<string, unknown>) => ({
    approvalRules: [],
    approvalReviewer: "off",
    ...partial,
  }));
  vi.stubGlobal("zen", {
    agent: {
      setSettings,
      getSettings: vi.fn(),
      onSettingsChanged: vi.fn().mockReturnValue(() => undefined),
      listSkills: vi.fn().mockResolvedValue([]),
    },
  });
}

/** 挂载权限页；rules/reviewer 注入 agent store（小节组件从 settings 读取） */
async function mountWith(
  rules: Array<{ pattern: string; decision: "allow" | "ask" }> = [],
  reviewer: "off" | "assistant" = "off",
): Promise<VueWrapper> {
  const agentStore = useAgentStore();
  agentStore.settings = {
    ...agentStore.settings,
    approvalRules: rules,
    approvalReviewer: reviewer,
  };
  const wrapper = mount(SettingsPermissions, {
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function inputByPlaceholder(wrapper: VueWrapper, text: string) {
  const input = wrapper
    .findAll("input")
    .find((item) => item.attributes("placeholder")?.includes(text));
  expect(input, `找不到 placeholder 含 ${text} 的输入框`).toBeTruthy();
  return input!;
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

function savedPayload(): Record<string, unknown> {
  return setSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  setSettings.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SettingsPermissions 命令规则与自动核准冒烟", () => {
  it("渲染三个原有小节与新的审批小节（标题/说明/空态/开关齐备）", async () => {
    stubZen();
    const wrapper = await mountWith();

    // 原有小节仍在
    expect(wrapper.text()).toContain("权限管理");
    expect(wrapper.text()).toContain("项目隔离区");
    expect(wrapper.text()).toContain("桌面自动化（CUA）");
    // 新小节
    expect(wrapper.text()).toContain("命令规则与自动核准");
    expect(wrapper.text()).toContain("命令前缀规则");
    expect(wrapper.text()).toContain("暂无规则");
    expect(wrapper.text()).toContain("帮我核准");
    expect(wrapper.find('button[aria-label="助手模型自动审阅审批请求"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("添加规则：trim 后写入 approvalRules，载荷可 structured clone，输入框清空", async () => {
    stubZen();
    const wrapper = await mountWith();

    await inputByPlaceholder(wrapper, "命令前缀，如 git status").setValue("  git push  ");
    await buttonByText(wrapper, "添加规则").trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(savedPayload()).toMatchObject({
      approvalRules: [{ pattern: "git push", decision: "allow" }],
    });
    // IPC 过桥要求纯对象（zen-005）：载荷不得携带响应式 Proxy
    expect(() => structuredClone(savedPayload())).not.toThrow();
    expect(inputByPlaceholder(wrapper, "命令前缀，如 git status").element.value).toBe("");
    wrapper.unmount();
  });

  it("空 pattern 不保存；已有规则行展示 pattern 与处置标签并可删除", async () => {
    stubZen();
    const wrapper = await mountWith([
      { pattern: "git status", decision: "allow" },
      { pattern: "pnpm test", decision: "ask" },
    ]);

    // 规则行渲染：pattern + 处置标签
    expect(wrapper.text()).toContain("git status");
    expect(wrapper.text()).toContain("pnpm test");
    expect(wrapper.text()).toContain("自动放行");
    expect(wrapper.text()).toContain("人工确认");

    // 空 pattern 添加被拒绝
    await buttonByText(wrapper, "添加规则").trigger("click");
    expect(setSettings).not.toHaveBeenCalled();

    // 删除首条规则
    await wrapper.find('button[aria-label="删除规则 git status"]').trigger("click");
    await flushPromises();
    expect(savedPayload()).toMatchObject({
      approvalRules: [{ pattern: "pnpm test", decision: "ask" }],
    });
    wrapper.unmount();
  });

  it("帮我核准开关：翻转写入 approvalReviewer；开启后展示风险提示", async () => {
    stubZen();
    const wrapper = await mountWith([], "off");

    await wrapper.find('button[aria-label="助手模型自动审阅审批请求"]').trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(savedPayload()).toMatchObject({ approvalReviewer: "assistant" });
    // Switch 在 store 更新前不会立即改变渲染（设置保存由 mock 回写）——
    // 开启后（store 回填 assistant）出现风险提示
    const enabled = await mountWith([], "assistant");
    expect(enabled.text()).toContain("助手模型可能误判");
    enabled.unmount();
    wrapper.unmount();
  });
});
