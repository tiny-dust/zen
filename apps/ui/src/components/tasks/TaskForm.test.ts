import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TaskForm from "@/components/tasks/TaskForm.vue";

import type { VueWrapper } from "@vue/test-utils";

let pinia: ReturnType<typeof createPinia>;

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

async function mountForm(open = true): Promise<VueWrapper> {
  vi.stubGlobal("zen", {
    workspace: { list: vi.fn().mockResolvedValue([]) },
    task: { create: vi.fn() },
    agent: { setSettings: vi.fn() },
  });
  const wrapper = mount(TaskForm, {
    props: { open },
    global: {
      plugins: [pinia],
      stubs: {
        // Dialog 桩按 open 渲染：表单内容内联，便于断言分组与校验
        Dialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
        DialogContent: true,
        DialogHeader: true,
        DialogTitle: true,
        DialogDescription: true,
        DialogFooter: true,
        // Select 是 reka-ui 组合件，这里只渲染插槽，表单默认值由组件状态提供
        Select: { template: "<div><slot /></div>" },
        SelectTrigger: { template: "<div><slot /></div>" },
        SelectValue: true,
        SelectContent: { template: "<div><slot /></div>" },
        SelectItem: { template: "<div><slot /></div>" },
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TaskForm 宽度与分组", () => {
  it("桌面宽度 720px 且覆盖 DialogContent 默认最大宽度", async () => {
    const wrapper = await mountForm();
    const dialog = wrapper.find('[data-testid="task-form"]');
    expect(dialog.classes()).toContain("w-[min(720px,calc(100vw-48px))]");
    // 弹窗基础类在 sm 断点会压到 384px：靠项目既有的大面板开关放开
    expect(dialog.attributes("data-large-panel")).toBe("true");
    expect(dialog.classes()).toContain("max-h-[min(760px,calc(100vh-80px))]");
    wrapper.unmount();
  });

  it("按四组渲染小标题：目标 / 何时由谁 / 能力与范围 / 其他", async () => {
    const wrapper = await mountForm();

    for (const id of ["goal", "when", "scope", "other"]) {
      expect(wrapper.find(`[data-testid="task-form-group-${id}"]`).exists()).toBe(true);
    }
    expect(wrapper.text()).toContain("目标");
    expect(wrapper.text()).toContain("何时 / 由谁");
    expect(wrapper.text()).toContain("能力与范围");
    expect(wrapper.text()).toContain("其他");
    wrapper.unmount();
  });

  it("描述与完成条件的最小高度分别为 96px / 64px", async () => {
    const wrapper = await mountForm();
    const textareas = wrapper.findAll("textarea");
    expect(textareas).toHaveLength(2);
    expect(textareas[0]!.classes()).toContain("min-h-24");
    expect(textareas[1]!.classes()).toContain("min-h-16");
    wrapper.unmount();
  });

  it("聚焦时刷新工作区分组（打开即刷新行为不变）", async () => {
    const wrapper = await mountForm(false);
    await wrapper.setProps({ open: true });
    await flushPromises();
    const zen = (window as unknown as { zen: { workspace: { list: ReturnType<typeof vi.fn> } } }).zen;
    expect(zen.workspace.list).toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("TaskForm 必填校验", () => {
  it("空标题阻止进入确认步骤", async () => {
    const wrapper = await mountForm();
    await buttonByText(wrapper, "下一步").trigger("click");
    expect(wrapper.find('[data-testid="task-form-error"]').text()).toContain("请填写标题");
    expect(wrapper.find('[data-testid="task-form-next"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("填了标题但缺目标时仍拦截，且不再停留在确认步骤", async () => {
    const wrapper = await mountForm();
    const titleInput = wrapper.find('input[placeholder*="本周 PR"]');
    await titleInput.setValue("整理风险清单");
    await buttonByText(wrapper, "下一步").trigger("click");
    expect(wrapper.find('[data-testid="task-form-error"]').text()).toContain("请填写目标");
    expect(wrapper.find('[data-testid="task-form-create"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
