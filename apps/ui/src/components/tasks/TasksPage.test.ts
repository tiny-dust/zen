import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TasksPage from "@/components/tasks/TasksPage.vue";

import type { VueWrapper } from "@vue/test-utils";
import type { Task, TaskAttempt } from "@zen/shared";

/**
 * 任务整页：列表渲染、阶段筛选、打开详情、新建校验（表单 → 授权确认 → create）。
 * Dialog/Select 用桩驱动：reka 的 Portal 与 Select 在 happy-dom 缺 pointer capture，
 * 桩只保留「open 时渲染内容」与选项值，不复制组件实现。
 */

function taskFixture(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "整理待办",
    goal: "把今天的待办理一遍",
    trigger: { kind: "manual" },
    executor: { kind: "agent", tools: ["read"] },
    grant: { level: 1, paths: ["/repo"], grantedAt: Date.now(), expiresAt: Date.now() + 86400_000 },
    budget: { maxRetries: 1 },
    acceptance: "user",
    status: "idle",
    enabled: true,
    gen: 1,
    retryCount: 0,
    consecutiveFailures: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  };
}

function attemptFixture(patch: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    id: "a1",
    taskId: "t1",
    gen: 1,
    cause: "manual",
    status: "succeeded",
    startedAt: Date.now() - 60_000,
    endedAt: Date.now() - 30_000,
    usage: { inputTokens: 10, outputTokens: 20 },
    result: { summary: "已完成" },
    ...patch,
  };
}

const create = vi.fn();
const get = vi.fn();
const journal = vi.fn();

let tasks: Task[] = [];

function stubZen(): void {
  vi.stubGlobal("zen", {
    tasks: {
      list: vi.fn(async () => ({ tasks, queue: {} })),
      get,
      journal,
      create,
      update: vi.fn(),
      runNow: vi.fn(async () => ({ ok: true })),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      ack: vi.fn(),
      remove: vi.fn(async () => ({ ok: true })),
      decide: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => undefined),
    },
    scheduler: {
      list: vi.fn(async () => []),
      listRuns: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => ({ ok: true })),
      toggle: vi.fn(),
      runNow: vi.fn(async () => ({ ok: true })),
      onChanged: vi.fn().mockReturnValue(() => undefined),
      onRunEvent: vi.fn().mockReturnValue(() => undefined),
    },
    workspace: { list: vi.fn(async () => []) },
  });
}

/** Dialog 内容走 reka Portal 落进 document.body，测试用 DOMWrapper 在 body 上找 */
function bodyFind(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector);
  if (!el) {
    throw new Error(`missing element: ${selector}`);
  }
  return new DOMWrapper(el);
}

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(TasksPage, {
    global: {
      plugins: [createPinia()],
      stubs: {
        Select: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: "<div><slot /></div>",
        },
        SelectTrigger: { template: "<div><slot /></div>" },
        SelectValue: { template: "<span />" },
        SelectContent: { template: "<div><slot /></div>" },
        SelectItem: { props: ["value"], template: '<div :data-value="value"><slot /></div>' },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async (input: { title: string }) => taskFixture({ id: "new-task", title: input.title }));
  get.mockReset();
  get.mockImplementation(async (id: string) => {
    const task = tasks.find((item) => item.id === id);
    return task ? { task, attempts: [attemptFixture({ taskId: task.id })] } : null;
  });
  journal.mockReset();
  journal.mockResolvedValue([]);
  tasks = [
    taskFixture({ id: "t1", title: "整理待办", status: "idle" }),
    taskFixture({
      id: "t2",
      title: "跑构建",
      status: "running",
      trigger: { kind: "schedule", schedule: { kind: "interval", every: 30, unit: "minute" } },
      nextRunAt: Date.now() + 1800_000,
    }),
    taskFixture({ id: "t3", title: "写周报", status: "awaiting_accept" }),
  ];
  stubZen();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TasksPage", () => {
  it("渲染任务卡片与阶段计数", async () => {
    const wrapper = await mountPage();
    expect(wrapper.findAll("[data-testid^='task-card-']")).toHaveLength(3);
    expect(wrapper.text()).toContain("整理待办");
    expect(wrapper.text()).toContain("跑构建");
    expect(wrapper.get("[data-testid='tasks-stage-needs_you']").text()).toContain("1");
  });

  it("阶段筛选只看该阶段任务", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tasks-stage-in_progress']").trigger("click");
    const cards = wrapper.findAll("[data-testid^='task-card-']");
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain("跑构建");
  });

  it("点开卡片进入详情：执行历史与两个 tab 都在", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='task-card-t3'] button").trigger("click");
    await flushPromises();
    expect(get).toHaveBeenCalledWith("t3");
    const detail = wrapper.get("[data-testid='task-detail']");
    expect(detail.text()).toContain("写周报");
    expect(detail.text()).toContain("进度与对话");
    expect(detail.text()).toContain("规则与设置");
    expect(detail.text()).toContain("已完成");
  });

  it("新建任务：空表单拦住，填写后走授权确认再 create", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tasks-create']").trigger("click");
    await flushPromises();

    await bodyFind("[data-testid='task-form-next']").trigger("click");
    expect(bodyFind("[data-testid='task-form-error']").text()).toBe("请填写标题");
    expect(create).not.toHaveBeenCalled();

    const inputs = bodyFind("[data-testid='task-form']").findAll("input");
    await inputs[0].setValue("新任务");
    const textareas = bodyFind("[data-testid='task-form']").findAll("textarea");
    await textareas[0].setValue("把风险列出来");

    await bodyFind("[data-testid='task-form-next']").trigger("click");
    expect(bodyFind("[data-testid='task-form']").text()).toContain("确认授权");

    await bodyFind("[data-testid='task-form-create']").trigger("click");
    await flushPromises();

    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0][0] as {
      title: string;
      goal: string;
      trigger: { kind: string };
      executor: { kind: string; tools: string[] };
      grant: { level: number };
    };
    expect(input.title).toBe("新任务");
    expect(input.goal).toBe("把风险列出来");
    expect(input.trigger.kind).toBe("manual");
    expect(input.executor).toMatchObject({ kind: "agent", tools: ["read"] });
    expect(input.grant.level).toBe(1);
  });

  it("只渲染任务，不再加载旧计划任务", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='legacy-schedules']").exists()).toBe(false);
    expect(window.zen?.scheduler.list).not.toHaveBeenCalled();
  });

  it("切到看板显示四列", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tasks-view-board']").trigger("click");
    expect(wrapper.find("[data-testid='task-board']").exists()).toBe(true);
    for (const stage of ["todo", "in_progress", "needs_you", "done"]) {
      expect(wrapper.find(`[data-testid='task-column-${stage}']`).exists()).toBe(true);
    }
  });

  it("打开已归档开关后只显示归档任务", async () => {
    tasks = [taskFixture({ id: "t4", title: "老任务", status: "done", archivedAt: Date.now() })];
    stubZen();
    const wrapper = await mountPage();
    expect(wrapper.findAll("[data-testid^='task-card-']")).toHaveLength(0);

    await wrapper.get("[data-testid='tasks-archived-toggle']").trigger("click");
    const cards = wrapper.findAll("[data-testid^='task-card-']");
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain("老任务");
  });
});
