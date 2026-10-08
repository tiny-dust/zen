import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Toaster from "@/components/ui/toast/Toaster.vue";
import { toast, useToasts } from "@/components/ui/toast/useToast";

describe("ui/toast Toaster 冒烟", () => {
  it("渲染 toast 列表并可手动关闭", async () => {
    const { toasts } = useToasts();
    toasts.value = [];

    const wrapper = mount(Toaster, { attachTo: document.body });
    toast.ok("保存成功", 0);
    toast.err("保存失败", 0);
    await Promise.resolve();

    expect(wrapper.text()).toContain("保存成功");
    expect(wrapper.text()).toContain("保存失败");

    await wrapper.get('button[aria-label="关闭提示"]').trigger("click");
    expect(toasts.value).toHaveLength(1);
    wrapper.unmount();
    toasts.value = [];
  });
});
