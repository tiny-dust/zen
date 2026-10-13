import { CalendarDate } from "@internationalized/date";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";

import { DateField, TimeField } from "@/components/scheduler";

/**
 * 调度字段组件自身的拆合逻辑：
 * - TimeField："HH:mm" ↔ 时/分双 Select（补零、重组）
 * - DateField："YYYY-MM-DD" ↔ Calendar（DateValue），选中即回写并收起
 * Select/Popover/Calendar 用桩驱动（reka-ui 组合件在 happy-dom 缺 pointer capture）。
 */

/** Select 桩：显示当前值，按钮模拟选 option */
const SelectStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `
    <div class="select-stub" :data-value="modelValue">
      <button type="button" data-set="14" @click="$emit('update:modelValue', '14')">14</button>
      <button type="button" data-set="45" @click="$emit('update:modelValue', '45')">45</button>
    </div>
  `,
};

describe("TimeField", () => {
  it("单数位 HH:mm 补零拆为时/分", () => {
    const wrapper = mount(TimeField, {
      props: { modelValue: "9:5" },
      global: { stubs: { Select: SelectStub, SelectTrigger: true, SelectValue: true } },
    });
    const stubs = wrapper.findAll(".select-stub").map((item) => item.attributes("data-value"));
    expect(stubs).toEqual(["09", "05"]);
    wrapper.unmount();
  });

  it("改时/改分后重组为完整 HH:mm", async () => {
    const wrapper = mount(TimeField, {
      props: { modelValue: "09:05" },
      global: { stubs: { Select: SelectStub, SelectTrigger: true, SelectValue: true } },
    });
    // 时：09 → 14
    const hourStub = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "09");
    await hourStub!.find('button[data-set="14"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["14:05"]);

    // 分：05 → 45（组件无父级 v-model，内部仍为 09，重组基于 props）
    const minuteStub = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "05");
    await minuteStub!.find('button[data-set="45"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual(["09:45"]);
    wrapper.unmount();
  });
});

/** Calendar 桩：按钮模拟选中一个 CalendarDate / 发出 undefined */
const CalendarStub = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  setup(_, { emit }) {
    return () =>
      h("div", [
        h(
          "button",
          { type: "button", class: "cal-pick", onClick: () => emit("update:modelValue", new CalendarDate(2026, 10, 20)) },
          "pick",
        ),
        h("button", { type: "button", class: "cal-empty", onClick: () => emit("update:modelValue", undefined) }, "empty"),
      ]);
  },
});

function mountDateField(modelValue: string, closeSpy: ReturnType<typeof vi.fn>) {
  return mount(DateField, {
    props: { modelValue },
    global: {
      stubs: {
        Calendar: CalendarStub,
        Popover: {
          setup() {
            return { close: closeSpy };
          },
          template: `<div><slot :close="close" /></div>`,
        },
        PopoverTrigger: { template: "<button><slot /></button>" },
        PopoverContent: { template: '<div><slot /></div>' },
      },
    },
  });
}

describe("DateField", () => {
  it("空值显示占位文案，选中后按语言格式化显示", async () => {
    const closeSpy = vi.fn();
    const wrapper = mountDateField("", closeSpy);
    // 默认 zh-CN
    expect(wrapper.text()).toContain("选择日期");

    await wrapper.setProps({ modelValue: "2026-10-20" });
    expect(wrapper.text()).toContain("2026年10月20日");
    wrapper.unmount();
  });

  it("Calendar 选中即回写 ISO 日期并收起浮层；undefined 不回写", async () => {
    const closeSpy = vi.fn();
    const wrapper = mountDateField("2026-10-20", closeSpy);

    await wrapper.find(".cal-empty").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(closeSpy).not.toHaveBeenCalled();

    await wrapper.find(".cal-pick").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["2026-10-20"]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
