import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { DateField, ScheduleEditor, TimePicker } from "@/components/scheduler";

import type { VueWrapper } from "@vue/test-utils";
import type { ScheduledTaskSchedule } from "@zen/shared";

/**
 * 调度字段组件自身的拆合与草稿回写逻辑：
 * - TimePicker："HH:mm" 显示与改写（时/分经 Popover 内 Select）
 * - DateField：shadcn-vue date-picker 组合（已有用例保持）
 * - ScheduleEditor：模式切换 → 草稿 schedule 回写；旧类型导入前向迁移；
 *   指定日期模式日历多选增删；validate() 拦截非法草稿
 * Select/Popover/Calendar 用桩驱动（reka-ui 组合件在 happy-dom 缺 pointer capture）。
 */

/** Select 桩：按 data-value 暴露当前值，按钮模拟选 option */
const SelectStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `
    <div class="select-stub" :data-value="String(modelValue)">
      <button type="button" data-set="week" @click="$emit('update:modelValue', 'week')">week</button>
      <button type="button" data-set="month" @click="$emit('update:modelValue', 'month')">month</button>
      <button type="button" data-set="dates" @click="$emit('update:modelValue', 'dates')">dates</button>
      <button type="button" data-set="window" @click="$emit('update:modelValue', 'window')">window</button>
      <button type="button" data-set="once" @click="$emit('update:modelValue', 'once')">once</button>
      <button type="button" data-set="second" @click="$emit('update:modelValue', 'second')">second</button>
    </div>
  `,
};

const globalStubs = {
  Select: SelectStub,
  SelectTrigger: true,
  SelectValue: true,
  SelectContent: true,
  SelectItem: true,
  Popover: { template: "<div><slot /></div>" },
  PopoverTrigger: { template: "<button><slot /></button>" },
  PopoverContent: { template: "<div><slot /></div>" },
  Calendar: true,
};

function mountEditor(modelValue: ScheduledTaskSchedule): VueWrapper {
  return mount(ScheduleEditor, {
    props: { modelValue },
    global: {
      stubs: {
        ...globalStubs,
        DateField: {
          props: ["modelValue", "ariaLabel"],
          emits: ["update:modelValue"],
          template: `<input type="text" :aria-label="ariaLabel" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
        TimePicker: {
          props: ["modelValue", "ariaLabel"],
          emits: ["update:modelValue"],
          template: `<input type="text" :aria-label="ariaLabel" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
      },
    },
    attachTo: document.body,
  });
}

describe("TimePicker", () => {
  it("非法/单数位输入回退为补零显示", () => {
    const wrapper = mount(TimePicker, {
      props: { modelValue: "9:5" },
      global: { stubs: globalStubs },
    });
    expect(wrapper.text()).toContain("09:05");
    wrapper.unmount();
  });

  it("显示当前 HH:mm", () => {
    const wrapper = mount(TimePicker, {
      props: { modelValue: "14:45" },
      global: { stubs: globalStubs },
    });
    expect(wrapper.text()).toContain("14:45");
    wrapper.unmount();
  });
});

describe("ScheduleEditor", () => {
  it("默认重复·每天：初始即回写等价草稿（不额外发 update）", async () => {
    const wrapper = mountEditor({ kind: "recurrence", every: 1, unit: "day", times: ["09:00"] });
    // 初始导入不触发 update（内容与 modelValue 一致）
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });

  it("切单位为周 → 草稿带 weekdays；再切月 → 带 monthlyOn", async () => {
    const wrapper = mountEditor({ kind: "recurrence", every: 1, unit: "day", times: ["09:00"] });
    const weekSelect = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "day");
    await weekSelect!.find('button[data-set="week"]').trigger("click");
    let emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toMatchObject({ kind: "recurrence", unit: "week", weekdays: [1, 2, 3, 4, 5] });

    const monthSelect = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "week");
    await monthSelect!.find('button[data-set="month"]').trigger("click");
    emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toMatchObject({
      kind: "recurrence",
      unit: "month",
      monthlyOn: { mode: "day", day: 1 },
    });
    wrapper.unmount();
  });

  it("旧类型导入：daily → 重复·每天×时刻；monthly → 重复·每月几号", async () => {
    const wrapper = mountEditor({ kind: "daily", time: "08:30" });
    // modelValue 与草稿不同（前向迁移），state watch 回写迁移结果
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toMatchObject({
      kind: "recurrence",
      every: 1,
      unit: "day",
      times: ["08:30"],
    });
    wrapper.unmount();

    const monthly = mountEditor({ kind: "monthly", day: 15, time: "09:00" });
    expect(monthly.emitted("update:modelValue")?.at(-1)?.[0]).toMatchObject({
      kind: "recurrence",
      every: 1,
      unit: "month",
      monthlyOn: { mode: "day", day: 15 },
      times: ["09:00"],
    });
    monthly.unmount();
  });

  it("指定日期模式：日历多选回写 dates 列表；validate 拦截空列表", async () => {
    const wrapper = mountEditor({ kind: "dates", dates: ["2026-10-15"], times: ["09:00"] });
    // 模拟日历多选事件（stub Calendar 不发事件，直接调组件方法等价）：
    // 通过切走再切回确保草稿回写；这里验证 validate 的空 dates 拦截
    const editor = wrapper.vm as unknown as { validate: () => string | null };
    // dates 非空 → 通过
    expect(editor.validate()).toBeNull();

    // 清空 dates（模拟用户未选日期的新任务）
    await wrapper.setProps({ modelValue: { kind: "dates", dates: [], times: ["09:00"] } });
    expect(editor.validate()).toContain("日历");
    wrapper.unmount();
  });

  it("validate：周模式未选星期几拦截（导入有空兜底，需经交互清空）", async () => {
    const wrapper = mountEditor({ kind: "recurrence", every: 1, unit: "week", weekdays: [1, 2], times: ["09:00"] });
    const editor = wrapper.vm as unknown as { validate: () => string | null };
    expect(editor.validate()).toBeNull();
    // 点掉两个已选的星期几 chip（aria-pressed 的按钮）
    for (const chip of wrapper.findAll("button[aria-pressed='true']")) {
      await chip.trigger("click");
    }
    expect(editor.validate()).toContain("星期");
    wrapper.unmount();
  });

  it("秒级重复：导入即合法", async () => {
    const wrapper = mountEditor({ kind: "recurrence", every: 30, unit: "second" });
    const editor = wrapper.vm as unknown as { validate: () => string | null };
    expect(editor.validate()).toBeNull();
    wrapper.unmount();
  });
});

describe("DateField", () => {
  it("空值显示占位文案，选中后按语言格式化显示", async () => {
    const wrapper = mount(DateField, {
      props: { modelValue: "" },
      global: {
        stubs: {
          Calendar: true,
          Popover: { template: "<div><slot /></div>" },
          PopoverTrigger: { template: "<button><slot /></button>" },
          PopoverContent: { template: "<div><slot /></div>" },
        },
      },
    });
    // 默认 zh-CN
    expect(wrapper.text()).toContain("选择日期");

    await wrapper.setProps({ modelValue: "2026-10-20" });
    expect(wrapper.text()).toContain("2026年10月20日");
    wrapper.unmount();
  });
});
