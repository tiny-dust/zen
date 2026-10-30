// 复现/回归：会话输入框 Enter 键与点击发送都无反应。
// 挂载真实 ChatComposer（含 ComposerEditor），走「输入 → Enter / 点击」完整绑定链路，
// 断言 agent.run 被调起。store 层测试（chat-send 等）只覆盖 send() 本身，覆盖不到
// update:modelValue → input 同步、keydown 拦截、发送按钮 disabled 这段 UI 绑定。
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatComposer from "@/components/chat/ChatComposer.vue";
import { useModelsStore } from "@/stores/models";

const agentRun = vi.fn();

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: agentRun.mockResolvedValue({ ok: true }),
    },
    session: {
      create: vi.fn(async (_workspaceId: string | null, id?: string) => ({
        id: id ?? "created",
        title: "新会话",
        workspaceId: null,
        draft: "",
        pinned: false,
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })),
      open: vi.fn(),
      setDraft: vi.fn(),
      rename: vi.fn(),
      setWorkspace: vi.fn(),
    },
    workspace: {
      list: vi.fn().mockResolvedValue([
        {
          id: "common",
          name: "公共区",
          kind: "common",
          path: null,
          archived: false,
          pinned: false,
          sessions: [],
        },
      ]),
    },
    git: {
      info: vi.fn().mockResolvedValue({ repo: "", branch: "" }),
      status: vi.fn().mockResolvedValue(null),
    },
    voice: { probe: vi.fn().mockResolvedValue({ supported: false }) },
  });
}

const wrappers: ReturnType<typeof mount>[] = [];

function composer() {
  const wrapper = mount(ChatComposer, {
    attachTo: document.body,
    global: {
      // 外围选单（模型/权限/模式等）与本次断言无关，stub 掉减少挂载面
      stubs: {
        PromptPicker: true,
        SessionModePicker: true,
        EffortSlider: true,
        ModelPicker: true,
        PermissionPicker: true,
        ContextUsagePicker: true,
        WorkspacePicker: true,
        ComposerBranchPicker: true,
        GoalChip: true,
        SkillUsageTags: true,
        QueuedMessages: true,
        AskUserCard: true,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

/** 在 contenteditable 里打字：直接改 textContent 后派发 input，走 onInput → update:modelValue */
function type(wrapper: ReturnType<typeof composer>, text: string) {
  const editor = wrapper.get(".composer-editor").element;
  editor.textContent = text;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

beforeEach(() => {
  setActivePinia(createPinia());
  stubZen();
  const models = useModelsStore();
  models.selection = { providerId: "p1", modelId: "m1" };
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ChatComposer 发送交互", () => {
  it("高级控制按需展开，常用发送操作保持可见", async () => {
    const wrapper = composer();
    const more = wrapper.get('button[aria-controls="composer-advanced-options"]');

    expect(more.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("session-mode-picker-stub").exists()).toBe(false);
    expect(wrapper.find("model-picker-stub").exists()).toBe(true);
    expect(wrapper.get('button[aria-label="添加文件"]')).toBeTruthy();

    await more.trigger("click");
    expect(more.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("session-mode-picker-stub").exists()).toBe(true);
  });

  it("输入后 Enter 发送：agent.run 被调起", async () => {
    const wrapper = composer();
    type(wrapper, "你好");
    await wrapper.vm.$nextTick();

    const editor = wrapper.get(".composer-editor");
    await editor.trigger("keydown", { key: "Enter" });

    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(agentRun.mock.calls[0][0]).toMatchObject({ userMessage: "你好" });
  });

  it("输入后点击发送按钮：agent.run 被调起", async () => {
    const wrapper = composer();
    type(wrapper, "你好");
    await wrapper.vm.$nextTick();

    const sendButton = wrapper
      .findAll("button")
      .find((button) => button.attributes("aria-label")?.includes("发送") || button.text().includes("发送"));
    expect(sendButton).toBeTruthy();
    expect(sendButton!.attributes("disabled")).toBeUndefined();

    await sendButton!.trigger("click");
    expect(agentRun).toHaveBeenCalledTimes(1);
    expect(agentRun.mock.calls[0][0]).toMatchObject({ userMessage: "你好" });
  });

  it("空输入时发送按钮禁用，Enter 不发消息", async () => {
    const wrapper = composer();
    await wrapper.vm.$nextTick();

    const sendButton = wrapper
      .findAll("button")
      .find((button) => button.attributes("aria-label")?.includes("发送") || button.text().includes("发送"));
    expect(sendButton).toBeTruthy();
    expect(sendButton!.attributes("disabled")).toBeDefined();

    await wrapper.get(".composer-editor").trigger("keydown", { key: "Enter" });
    expect(agentRun).not.toHaveBeenCalled();
  });
});
