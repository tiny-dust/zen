import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ZenApi } from "@/types/zen-api";
import type {
  Task,
  TaskAttempt,
  TaskInput,
  TaskJournalEntry,
  TaskListResult,
  TaskQueueInfo,
  TaskStreamEvent,
} from "@zen/shared";

/** 主进程桥：类型与 apps/desktop/src/preload/tasks.ts、zen-api 的 tasks 段一致 */
type TasksBridge = ZenApi["tasks"];

function tasksBridge(): TasksBridge | null {
  return window.zen?.tasks ?? null;
}

/** IPC 边界一律过纯对象（Proxy 过桥会抛克隆错误） */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 任务：列表 + 队列 + 选中任务详情（执行记录 / 事件日志）。
 * 数据源为主进程（tasks:list / tasks:get / tasks:journal），
 * 状态变化经 tasks:event 推送：任何 event 都刷新列表，命中当前选中的任务再刷新详情。
 */
export const useTasksStore = defineStore("tasks", () => {
  const tasks = ref<Task[]>([]);
  const queue = ref<Record<string, TaskQueueInfo>>({});
  const selectedId = ref<string | null>(null);
  const attempts = ref<TaskAttempt[]>([]);
  const journal = ref<TaskJournalEntry[]>([]);
  const loaded = ref(false);
  const error = ref("");

  let unbindEvent: (() => void) | null = null;

  const selected = computed(() => tasks.value.find((task) => task.id === selectedId.value) ?? null);
  const selectedAttempts = computed(() => attempts.value);
  const selectedJournal = computed(() => journal.value);
  const selectedQueue = computed(() => (selectedId.value ? (queue.value[selectedId.value] ?? null) : null));

  function fail(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    error.value = message;
    return message;
  }

  function applyTask(task: Task): void {
    const index = tasks.value.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      tasks.value.splice(index, 1, task);
    } else {
      tasks.value.push(task);
    }
  }

  async function refreshDetail(id: string): Promise<void> {
    const bridge = tasksBridge();
    if (!bridge) {
      return;
    }
    try {
      const [detail, entries] = await Promise.all([bridge.get(id), bridge.journal(id)]);
      if (selectedId.value !== id) {
        return;
      }
      if (detail) {
        applyTask(detail.task);
        attempts.value = detail.attempts;
        queue.value = { ...queue.value, ...(detail.queue ? { [id]: detail.queue } : {}) };
      }
      journal.value = entries;
      error.value = "";
    } catch (err) {
      fail(err);
    }
  }

  /** 事件订阅：首次 load 时绑定，页面卸载时 dispose */
  function ensureSubscriptions(): void {
    const bridge = tasksBridge();
    if (!bridge || unbindEvent) {
      return;
    }
    unbindEvent = bridge.onEvent((event) => {
      void load();
      if (event.taskId === selectedId.value) {
        void refreshDetail(event.taskId);
      }
    });
  }

  function dispose(): void {
    unbindEvent?.();
    unbindEvent = null;
  }

  async function load(): Promise<void> {
    const bridge = tasksBridge();
    if (!bridge) {
      return;
    }
    ensureSubscriptions();
    try {
      const result = await bridge.list();
      tasks.value = result.tasks;
      queue.value = result.queue;
      loaded.value = true;
      error.value = "";
    } catch (err) {
      fail(err);
    }
  }

  async function select(id: string): Promise<void> {
    selectedId.value = id;
    attempts.value = [];
    journal.value = [];
    await refreshDetail(id);
  }

  function clearSelection(): void {
    selectedId.value = null;
    attempts.value = [];
    journal.value = [];
  }

  async function create(input: TaskInput): Promise<{ task: Task } | { error: string }> {
    const bridge = tasksBridge();
    if (!bridge) {
      return { error: "window.zen.tasks unavailable" };
    }
    try {
      const result = await bridge.create(plain(input));
      if ("error" in result) {
        return { error: result.error };
      }
      applyTask(result);
      return { task: result };
    } catch (err) {
      return { error: fail(err) };
    }
  }

  async function update(id: string, patch: Partial<TaskInput>): Promise<string | null> {
    const bridge = tasksBridge();
    if (!bridge) {
      return "window.zen.tasks unavailable";
    }
    try {
      const result = await bridge.update({ id, ...plain(patch) });
      if ("error" in result) {
        return result.error;
      }
      applyTask(result);
      return null;
    } catch (err) {
      return fail(err);
    }
  }

  async function runNow(id: string): Promise<string | null> {
    const bridge = tasksBridge();
    if (!bridge) {
      return "window.zen.tasks unavailable";
    }
    try {
      const result = await bridge.runNow(id);
      if (!result.ok) {
        return result.error ?? "run failed";
      }
      await load();
      return null;
    } catch (err) {
      return fail(err);
    }
  }

  /** pause / resume / cancel / archive / unarchive / ack / accept 共用：返回新任务，失败给错误文案 */
  async function applyAction(
    id: string,
    action: (bridge: TasksBridge) => Promise<Task | null>,
  ): Promise<string | null> {
    const bridge = tasksBridge();
    if (!bridge) {
      return "window.zen.tasks unavailable";
    }
    try {
      const task = await action(bridge);
      if (task) {
        applyTask(task);
        if (task.id === selectedId.value) {
          await refreshDetail(task.id);
        }
      }
      return null;
    } catch (err) {
      return fail(err);
    }
  }

  const pause = (id: string) => applyAction(id, (bridge) => bridge.pause(id));
  const resume = (id: string) => applyAction(id, (bridge) => bridge.resume(id));
  const cancel = (id: string) => applyAction(id, (bridge) => bridge.cancel(id));
  const archive = (id: string) => applyAction(id, (bridge) => bridge.archive(id));
  const unarchive = (id: string) => applyAction(id, (bridge) => bridge.unarchive(id));
  const ack = (id: string) => applyAction(id, (bridge) => bridge.ack(id));
  const accept = (id: string) => applyAction(id, (bridge) => bridge.accept(id));
  const reject = (id: string, feedback: string) =>
    applyAction(id, (bridge) => bridge.reject(id, feedback));
  const decide = (id: string, approve: boolean, text?: string) =>
    applyAction(id, (bridge) => bridge.decide(id, approve, text));

  async function remove(id: string): Promise<string | null> {
    const bridge = tasksBridge();
    if (!bridge) {
      return "window.zen.tasks unavailable";
    }
    try {
      await bridge.remove(id);
      tasks.value = tasks.value.filter((task) => task.id !== id);
      const nextQueue = { ...queue.value };
      delete nextQueue[id];
      queue.value = nextQueue;
      if (selectedId.value === id) {
        clearSelection();
      }
      return null;
    } catch (err) {
      return fail(err);
    }
  }

  return {
    tasks,
    queue,
    selectedId,
    attempts,
    journal,
    loaded,
    error,
    selected,
    selectedAttempts,
    selectedJournal,
    selectedQueue,
    load,
    select,
    clearSelection,
    refreshDetail,
    dispose,
    create,
    update,
    runNow,
    pause,
    resume,
    cancel,
    archive,
    unarchive,
    ack,
    accept,
    reject,
    decide,
    remove,
  };
});
