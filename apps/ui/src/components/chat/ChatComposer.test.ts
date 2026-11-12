// 复现/回归：会话输入框 Enter 键与点击发送都无反应。
// 挂载真实 ChatComposer（含 ComposerEditor），走「输入 → Enter / 点击」完整绑定链路，
// 断言 agent.run 被调起。store 层测试（chat-send 等）只覆盖 send() 本身，覆盖不到
// update:modelValue → input 同步、keydown 拦截、发送按钮 disabled 这段 UI 绑定。
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatComposer from "@/components/chat/ChatComposer.vue";
import { hasOpenOverlayLayer } from "@/composables/useBrowserOverlayAutoGuard";
import { useBrowserStore } from "@/stores/browser";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";

import type { ProviderSummary } from "@zen/shared";

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
      previewFile: vi.fn().mockResolvedValue({ kind: "image", dataUrl: "data:image/png;base64,AA==", size: 512 }),
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
    browser: {
      screenshot: vi.fn().mockResolvedValue({ ok: true, path: "/cache/browser-shot.png" }),
      setBounds: vi.fn().mockResolvedValue(undefined),
    },
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

  it("推理模型的思考强度常驻模型左侧，非推理模型不显示且高级区不重复", async () => {
    const models = useModelsStore();
    const provider: ProviderSummary = {
      id: "p1", name: "Test", protocol: "openai-chat", baseUrl: "", enabled: true,
      hasApiKey: false, apiKeyMask: "", createdAt: 1, updatedAt: 1,
      models: [
        { id: "m1", name: "Reasoner", enabled: true, capabilities: { reasoning: true, reasoningEfforts: ["low", "high"] } },
        { id: "m2", name: "Plain", enabled: true, capabilities: { reasoning: false } },
      ],
    };
    models.providers = [provider];
    const wrapper = composer();
    const effort = wrapper.get("effort-slider-stub");
    const picker = wrapper.get("model-picker-stub");
    expect(effort.element.nextElementSibling).toBe(picker.element);
    expect(effort.attributes("allowed")).toBe("low,high");

    await wrapper.get('button[aria-controls="composer-advanced-options"]').trigger("click");
    expect(wrapper.findAll("effort-slider-stub")).toHaveLength(1);
    models.selection = { providerId: "p1", modelId: "m2" };
    await wrapper.vm.$nextTick();
    expect(wrapper.find("effort-slider-stub").exists()).toBe(false);
  });

  it("窄底栏收起更多选项的文字，保留可访问名称和模型入口", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const wrapper = composer();
    const more = wrapper.get('button[aria-controls="composer-advanced-options"]');
    expect(more.text()).toBe("");
    expect(more.attributes("aria-label")).toBe("更多选项");
    expect(wrapper.get("model-picker-stub").attributes("compact")).toBe("true");
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

  it("浏览器截图在输入区显示图片缩略图，并作为图片附件发送", async () => {
    const wrapper = composer();
    const browser = useBrowserStore();
    const chat = useChatStore();
    browser.showHome = false;

    await browser.takeScreenshot();
    await vi.waitFor(() => {
      expect(wrapper.get('img[alt="browser-shot.png"]').attributes("src")).toBe("data:image/png;base64,AA==");
    });
    expect(wrapper.get(".composer-editor").text()).not.toContain("/cache/browser-shot.png");
    expect(chat.attachments).toEqual([
      expect.objectContaining({ name: "browser-shot.png", path: "/cache/browser-shot.png", isImage: true }),
    ]);

    await chat.send();
    expect(agentRun).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ name: "browser-shot.png", path: "/cache/browser-shot.png" }],
    }));
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

  it.each(["/", "#"])("输入 %s 唤起建议列表时，仅与浏览器相交才隐藏视图", async (trigger) => {
    const wrapper = composer();
    const browser = useBrowserStore();
    browser.viewRect = { x: 800, y: 48, width: 400, height: 600 };

    type(wrapper, trigger);
    await wrapper.vm.$nextTick();
    const list = wrapper.get('[role="listbox"][data-browser-overlay-geometry]');
    expect(hasOpenOverlayLayer()).toBe(false);
    list.element.getBoundingClientRect = () => ({
      left: 300, right: 700, top: 300, bottom: 420, width: 400, height: 120,
    }) as DOMRect;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(browser.overlayDepth).toBe(0);

    list.element.getBoundingClientRect = () => ({
      left: 700, right: 900, top: 300, bottom: 420, width: 200, height: 120,
    }) as DOMRect;
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(browser.overlayDepth).toBe(1);

    await wrapper.get(".composer-editor").trigger("keydown", { key: "Escape" });
    expect(browser.overlayDepth).toBe(0);
  });
});
