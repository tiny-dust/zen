import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";

import type { VueWrapper } from "@vue/test-utils";

type DialogProps = Partial<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pending: boolean;
}>;

function mountDialog(props: DialogProps = {}): VueWrapper {
  return mount(ConfirmDialog, {
    props: { open: true, title: "删除工作区", ...props },
    global: {
      stubs: {
        Dialog: true,
        DialogContent: true,
        DialogTitle: true,
        DialogDescription: true,
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

describe("ConfirmDialog", () => {
  it("渲染标题与可选描述，缺省按钮为删除/取消", () => {
    const wrapper = mountDialog({ description: "此操作不可撤销" });

    expect(wrapper.text()).toContain("删除工作区");
    expect(wrapper.text()).toContain("此操作不可撤销");
    expect(buttonByText(wrapper, "删除").exists()).toBe(true);
    expect(buttonByText(wrapper, "取消").exists()).toBe(true);
    wrapper.unmount();
  });

  it("无描述时不渲染描述区域，自定义按钮文案生效", () => {
    const wrapper = mountDialog({ confirmLabel: "归档", cancelLabel: "再想想" });

    // description 缺省为空 → DialogDescription 分支不渲染
    expect(wrapper.find('[data-slot="dialog-description"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("此操作不可撤销");
    expect(buttonByText(wrapper, "归档").exists()).toBe(true);
    expect(buttonByText(wrapper, "再想想").exists()).toBe(true);
    wrapper.unmount();
  });

  it("点击确认触发 confirm 事件", async () => {
    const wrapper = mountDialog();

    await buttonByText(wrapper, "删除").trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    expect(wrapper.emitted("update:open")).toBeUndefined();
    wrapper.unmount();
  });

  it("点击取消触发 update:open=false", async () => {
    const wrapper = mountDialog();

    await buttonByText(wrapper, "取消").trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("confirm")).toBeUndefined();
    wrapper.unmount();
  });

  it("pending 时两个按钮均禁用，防止重复提交", () => {
    const wrapper = mountDialog({ pending: true });

    expect(buttonByText(wrapper, "删除").attributes("disabled")).toBeDefined();
    expect(buttonByText(wrapper, "取消").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("Dialog 容器 update:open 转发为组件事件", async () => {
    const wrapper = mountDialog();
    // stub 的 Dialog 直接触发 update:open，组件应透传
    wrapper.findComponent({ name: "Dialog" }).vm.$emit("update:open", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    wrapper.unmount();
  });

  it("confirm 按钮排在 DOM 前面以承接初始焦点（可访问性约束）", () => {
    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    // 危险确认按钮在前，取消在后（视觉顺序由 order-* 类控制）
    expect(buttons[0]?.text().trim()).toBe("删除");
    expect(buttons[1]?.text().trim()).toBe("取消");
    wrapper.unmount();
  });
});
