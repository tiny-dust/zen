import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SchedulerDialog from "@/components/sidebar/SchedulerDialog.vue";

import type { VueWrapper } from "@vue/test-utils";
import type { Mock } from "vitest";
import type { ScheduledTask } from "@zen/shared";

/**
 * 计划任务弹窗：统一调度编辑器（ScheduleEditor）驱动的表单切换、校验与提交载荷；
 * Select/Calendar 等组合件用桩驱动（reka-ui 在 happy-dom 缺 pointer capture），
 * ScheduleEditor 自身的拆合/迁移逻辑由 SchedulerFields.test.ts 覆盖。
 */

let pinia: ReturnType<typeof createPinia>;
const create = vi.fn();

function taskFixture(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    name: "日报",
    prompt: "总结今天的提交",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    workspacePath: null,
    lastRunAt: null,
    lastResult: null,
    lastRunOk: null,
    lastSessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  };
}

async function mountDialog(tasks: ScheduledTask[] = []): Promise<VueWrapper> {
  create.mockImplementation(async (input: { schedule: ScheduledTask["schedule"] }) =>
    taskFixture({ schedule: input.schedule }),
  );
  vi.stubGlobal("zen", {
    scheduler: {
      list: vi.fn().mockResolvedValue(tasks),
      listRuns: vi.fn().mockResolvedValue([]),
      create,
      update: vi.fn(),
      remove: vi.fn().mockResolvedValue({ ok: true }),
      toggle: vi.fn(),
      runNow: vi.fn().mockResolvedValue({ ok: true }),
      onChanged: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
    },
    workspace: { list: vi.fn().mockResolvedValue([]) },
    session: { create: vi.fn() },
    shell: { platformInfo: vi.fn().mockResolvedValue({}) },
    browser: { setBounds: vi.fn() },
  });
  const wrapper = mount(SchedulerDialog, {
    props: { open: false },
    global: {
      plugins: [pinia],
      stubs: {
        Dialog: true,
        DialogContent: { template: "<div><slot /></div>" },
        DialogHeader: true,
        DialogTitle: true,
        DialogDescription: true,
        ConfirmDialog: true,
        teleport: true,
        Calendar: true,
        Popover: { template: "<div><slot /></div>" },
        PopoverTrigger: { template: "<button><slot /></button>" },
        PopoverContent: { template: "<div><slot /></div>" },
        // Select 桩：按当前值区分目标（mode=recurrence / unit=day / workspace=__common__ …）
        Select: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `
            <div class="select-stub" :data-value="String(modelValue)">
              <button type="button" data-set="recurrence" @click="$emit('update:modelValue', 'recurrence')">recurrence</button>
              <button type="button" data-set="window" @click="$emit('update:modelValue', 'window')">window</button>
              <button type="button" data-set="once" @click="$emit('update:modelValue', 'once')">once</button>
              <button type="button" data-set="dates" @click="$emit('update:modelValue', 'dates')">dates</button>
              <button type="button" data-set="second" @click="$emit('update:modelValue', 'second')">second</button>
              <button type="button" data-set="week" @click="$emit('update:modelValue', 'week')">week</button>
              <button type="button" data-set="month" @click="$emit('update:modelValue', 'month')">month</button>
            </div>
          `,
        },
        SelectTrigger: true,
        SelectValue: true,
        SelectContent: true,
        SelectItem: true,
        // TimePicker/DateField 桩：保持 input + aria-label 语义
        TimePicker: {
          props: ["modelValue", "ariaLabel"],
          emits: ["update:modelValue"],
          template: `
            <input
              type="text"
              :aria-label="ariaLabel"
              :value="modelValue"
              @input="$emit('update:modelValue', $event.target.value)"
            />
          `,
        },
        DateField: {
          props: ["modelValue", "ariaLabel"],
          emits: ["update:modelValue"],
          template: `
            <input
              type="text"
              :aria-label="ariaLabel"
              :value="modelValue"
              @input="$emit('update:modelValue', $event.target.value)"
            />
          `,
        },
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

function inputByLabel(wrapper: VueWrapper, label: string) {
  const fields = [...wrapper.findAll("input"), ...wrapper.findAll("textarea")];
  const input = fields.find((item) => item.attributes("aria-label") === label);
  expect(input, `找不到 aria-label=${label} 的输入框`).toBeTruthy();
  return input!;
}

/** 在「当前值为 current」的 Select 桩里点选项 next（页面有多个 Select，按值区分） */
async function setSelect(wrapper: VueWrapper, current: string, next: string) {
  const stub = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === current);
  expect(stub, `找不到当前值为 ${current} 的 Select`).toBeTruthy();
  const option = stub!.find(`button[data-set="${next}"]`);
  expect(option, `${current} Select 里没有选项 ${next}`).toBeTruthy();
  await option.trigger("click");
}

/** 列表视图 → 新建配置页（点顶栏「新建任务」按钮） */
async function openCreateForm(wrapper: VueWrapper) {
  const add = wrapper.findAll("button").find((item) => item.text().includes("新建任务"));
  expect(add, "列表视图应有「新建任务」入口").toBeTruthy();
  await add!.trigger("click");
  await flushPromises();
}

/** 配置页里点「保存」提交 */
async function submit(wrapper: VueWrapper) {
  const save = wrapper.findAll("button").find((item) => item.text().includes("保存"));
  expect(save, "配置页应有「保存」按钮").toBeTruthy();
  await save!.trigger("click");
  await flushPromises();
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

describe("SchedulerDialog 统一调度编辑器", () => {
  it("默认重复·每天：改间隔与单位后提交秒级重复调度", async () => {
    const wrapper = await mountDialog();
    await openCreateForm(wrapper);
    await inputByLabel(wrapper, "名称").setValue("秒级巡检");
    await inputByLabel(wrapper, "指令").setValue("看一眼构建状态");
    await inputByLabel(wrapper, "间隔").setValue("15");
    // 切单位为秒（unit Select 当前值为 day）
    await setSelect(wrapper, "day", "second");
    await submit(wrapper);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: "秒级巡检",
      schedule: { kind: "recurrence", every: 15, unit: "second" },
    });
    wrapper.unmount();
  });

  it("切到 每日时间范围：显示起止与间隔字段并提交范围调度", async () => {
    const wrapper = await mountDialog();
    await openCreateForm(wrapper);
    await inputByLabel(wrapper, "名称").setValue("工作时间巡检");
    await inputByLabel(wrapper, "指令").setValue("巡检");
    await setSelect(wrapper, "recurrence", "window");
    await inputByLabel(wrapper, "开始").setValue("09:30");
    await inputByLabel(wrapper, "结束").setValue("18:30");
    await inputByLabel(wrapper, "间隔（分钟）").setValue("20");
    await submit(wrapper);

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      schedule: { kind: "window", startTime: "09:30", endTime: "18:30", everyMinutes: 20 },
    });
    wrapper.unmount();
  });

  it("重复·每周：星期几多选 chips 提交 weekdays + 时刻", async () => {
    const wrapper = await mountDialog();
    await openCreateForm(wrapper);
    await inputByLabel(wrapper, "名称").setValue("周报");
    await inputByLabel(wrapper, "指令").setValue("汇总");
    await setSelect(wrapper, "day", "week");
    // 默认选中一~五；点掉「三」（第 3 个选中 chip）再选「六」
    const selected = wrapper.findAll("button[aria-pressed='true']");
    await selected[2].trigger("click");
    await wrapper.findAll("button[aria-pressed='false']").find((item) => item.text() === "六")!.trigger("click");
    await inputByLabel(wrapper, "时刻").setValue("10:00");
    await submit(wrapper);

    const weekdays = (create.mock.calls[0]?.[0] as { schedule: { weekdays: number[] } }).schedule.weekdays;
    expect(weekdays).toEqual([1, 2, 4, 5, 6]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      schedule: { kind: "recurrence", every: 1, unit: "week", times: ["10:00"] },
    });
    wrapper.unmount();
  });

  it("校验：范围起止相等 / 单次时间已过 均拦截并提示", async () => {
    const wrapper = await mountDialog();
    await openCreateForm(wrapper);
    await inputByLabel(wrapper, "名称").setValue("x");
    await inputByLabel(wrapper, "指令").setValue("y");

    // window 起止相等
    await setSelect(wrapper, "recurrence", "window");
    await inputByLabel(wrapper, "开始").setValue("09:00");
    await inputByLabel(wrapper, "结束").setValue("09:00");
    await inputByLabel(wrapper, "间隔（分钟）").setValue("30");
    await submit(wrapper);
    expect(wrapper.text()).toContain("结束时间须晚于开始时间");
    expect(create).not.toHaveBeenCalled();

    // once 时间已过（2000 年）
    await setSelect(wrapper, "window", "once");
    await inputByLabel(wrapper, "日期").setValue("2000-01-01");
    await inputByLabel(wrapper, "时间").setValue("09:00");
    await submit(wrapper);
    expect(wrapper.text()).toContain("单次任务的时间须晚于当前时间");
    expect(create).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("编辑回显：once 任务拆回日期+时间字段；旧 daily 前向迁移为重复·每天", async () => {
    const once = taskFixture({
      id: "t-once",
      schedule: { kind: "once", at: new Date(2026, 9, 20, 14, 30).getTime() },
    });
    const daily = taskFixture({
      id: "t-daily",
      name: "旧任务",
      schedule: { kind: "daily", time: "08:30" },
    });
    const wrapper = await mountDialog([once, daily]);

    const editButtons = wrapper.findAll('button[aria-label="编辑任务"]');
    await editButtons[0].trigger("click");
    await flushPromises();
    expect((inputByLabel(wrapper, "日期").element as HTMLInputElement).value).toBe("2026-10-20");
    expect((inputByLabel(wrapper, "时间").element as HTMLInputElement).value).toBe("14:30");

    // 取消回列表再编辑第二个任务（切换视图后旧按钮已卸载，需重新查询）
    const cancel = wrapper.findAll("button").find((item) => item.text().includes("取消"));
    await cancel!.trigger("click");
    await flushPromises();
    await wrapper.findAll('button[aria-label="编辑任务"]')[1].trigger("click");
    await flushPromises();
    expect((inputByLabel(wrapper, "时刻").element as HTMLInputElement).value).toBe("08:30");
    // 模式下拉当前值为 recurrence（已迁移），提交为 recurrence 载荷
    const modeStub = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "recurrence");
    expect(modeStub).toBeTruthy();
    wrapper.unmount();
  });

  it("列表徽标：新旧类型调度各有可读描述", async () => {
    const tasks = [
      taskFixture({
        id: "a",
        schedule: { kind: "recurrence", every: 1, unit: "week", weekdays: [1, 4], times: ["09:00"] },
      }),
      taskFixture({
        id: "b",
        schedule: { kind: "dates", dates: ["2026-10-15", "2026-11-03"], times: ["09:00"] },
      }),
      taskFixture({ id: "c", schedule: { kind: "interval", every: 10, unit: "second" } }),
      taskFixture({ id: "d", schedule: { kind: "daily", time: "08:30" } }),
      taskFixture({
        id: "e",
        schedule: { kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 30 },
      }),
    ];
    const wrapper = await mountDialog(tasks);
    const text = wrapper.text();
    expect(text).toContain("每周一、四 09:00");
    expect(text).toContain("指定 2 天 09:00");
    expect(text).toContain("每 10 秒");
    expect(text).toContain("每日 08:30");
    expect(text).toContain("每日 09:00–18:00，每 30 分钟");
    wrapper.unmount();
  });

  it("回归：工作区选项值永不为空串（reka SelectItem 空 value 会打断弹窗交互）", async () => {
    const wrapper = await mountDialog();
    await openCreateForm(wrapper);
    // 公共区选项使用哨兵值：工作区 Select 桩的当前值即 __common__（非空串）
    const stub = wrapper.findAll(".select-stub").find((item) => item.attributes("data-value") === "__common__");
    expect(stub).toBeTruthy();
    wrapper.unmount();
  });

  it("视图流：打开默认列表（无表单），点新建进配置页，取消回列表", async () => {
    const wrapper = await mountDialog([taskFixture()]);
    expect(wrapper.find('button[aria-label="编辑任务"]').exists(), "默认视图应是任务列表").toBe(true);
    expect(wrapper.find('input[aria-label="名称"]').exists(), "列表视图不应渲染配置表单").toBe(false);

    await openCreateForm(wrapper);
    expect(wrapper.find('input[aria-label="名称"]').exists(), "新建后应切到配置页").toBe(true);
    expect(wrapper.find('button[aria-label="编辑任务"]').exists(), "配置页不显示任务列表").toBe(false);

    const cancel = wrapper.findAll("button").find((item) => item.text().includes("取消"));
    await cancel!.trigger("click");
    await flushPromises();
    expect(wrapper.find('button[aria-label="编辑任务"]').exists(), "取消后应回到列表").toBe(true);
    expect(wrapper.find('input[aria-label="名称"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("SchedulerDialog 运行记录与查看运行", () => {
  /** stubGlobal 之后的 zen 桥（类型上可空；此处必然存在） */
  function zenApi() {
    expect(window.zen).toBeTruthy();
    return window.zen!;
  }

  /** 运行历史桩数据：成功（带摘要）+ 进行中（无会话） */
  function runFixtures() {
    return [
      {
        id: "r-1",
        taskId: "task-1",
        sessionId: "s-1",
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_060_000,
        ok: true,
        summary: "今日共 5 个提交",
      },
      {
        id: "r-2",
        taskId: "task-1",
        sessionId: null,
        startedAt: 1_700_000_100_000,
        finishedAt: null,
        ok: null,
        summary: null,
      },
    ];
  }

  it("展开运行记录：拉取历史并渲染状态徽标与摘要", async () => {
    const wrapper = await mountDialog([taskFixture()]);
    const listRuns = (zenApi().scheduler.listRuns as Mock).mockResolvedValue(runFixtures());

    await wrapper.findAll('button[aria-label="运行记录"]')[0].trigger("click");
    await flushPromises();

    expect(listRuns).toHaveBeenCalledWith("task-1");
    const text = wrapper.text();
    expect(text).toContain("成功");
    expect(text).toContain("运行中");
    expect(text).toContain("今日共 5 个提交");
    wrapper.unmount();
  });

  it("运行历史为空时显示占位；找不到会话时提示错误", async () => {
    const wrapper = await mountDialog([taskFixture()]);
    await wrapper.findAll('button[aria-label="运行记录"]')[0].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("还没有运行记录");

    // 历史行「查看运行」：侧栏数据里找不到该会话 → 卡上提示错误、弹窗不关
    (zenApi().scheduler.listRuns as Mock).mockResolvedValue(runFixtures());
    await wrapper.findAll('button[aria-label="运行记录"]')[0].trigger("click"); // 收起
    await wrapper.findAll('button[aria-label="运行记录"]')[0].trigger("click"); // 再展开（刷新）
    await flushPromises();
    await wrapper.findAll('button[aria-label="查看运行"]')[0].trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("找不到该次运行的会话");
    expect(wrapper.emitted("update:open") ?? []).not.toContainEqual([false]);
    wrapper.unmount();
  });

  it("查看运行：切到该次运行的会话并关闭弹窗", async () => {
    const wrapper = await mountDialog([taskFixture()]);
    (zenApi().scheduler.listRuns as Mock).mockResolvedValue(runFixtures());
    // 侧栏工作区数据含目标会话（openSessionById 的定位数据源）
    (zenApi().workspace.list as Mock).mockResolvedValue([
      {
        id: "common",
        name: "公共区",
        kind: "common",
        path: null,
        archived: false,
        pinned: false,
        sessions: [
          {
            id: "s-1",
            title: "计划任务：日报",
            workspaceId: null,
            draft: "",
            pinned: false,
            archived: false,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    ]);
    // chatStore.loadSession 链路上的最小桩（与 chat-draft.test 同口径）
    const sessionOpen = vi.fn().mockResolvedValue({
      session: {
        id: "s-1",
        title: "计划任务：日报",
        workspaceId: null,
        draft: "",
        pinned: false,
        archived: false,
        createdAt: 1,
        updatedAt: 2,
      },
      messages: [],
    });
    Object.assign(zenApi().session, {
      open: sessionOpen,
      setDraft: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn(),
      setWorkspace: vi.fn(),
    });
    Object.assign(zenApi(), {
      app: { info: vi.fn().mockResolvedValue({}) },
      agent: { onEvent: vi.fn(() => () => undefined) },
      git: {
        info: vi.fn().mockResolvedValue({ repo: "", branch: "" }),
        status: vi.fn().mockResolvedValue(null),
      },
    });

    await wrapper.findAll('button[aria-label="运行记录"]')[0].trigger("click");
    await flushPromises();
    await wrapper.findAll('button[aria-label="查看运行"]')[0].trigger("click");
    await flushPromises();

    expect(sessionOpen).toHaveBeenCalledWith("s-1");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });
});
