import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRunEvent } from "@zen/shared";

/**
 * 定时/计划任务：数据源为主进程（scheduler:list + scheduler:changed 推送），
 * 运行状态由 scheduler:run-event 驱动（started 加入 runningIds，done/error 移除）。
 * IPC 边界处一律 JSON.parse(JSON.stringify(...)) 过纯对象（Proxy 过桥会抛克隆错误）。
 */
export const useSchedulerStore = defineStore("scheduler", () => {
  const tasks = ref<ScheduledTask[]>([]);
  const runningIds = ref<Set<string>>(new Set());
  const loaded = ref(false);
  const error = ref("");

  let unbindChanged: (() => void) | null = null;
  let unbindRunEvent: (() => void) | null = null;

  const count = computed(() => tasks.value.length);

  function applyTask(task: ScheduledTask): void {
    const index = tasks.value.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      tasks.value.splice(index, 1, task);
    } else {
      tasks.value.push(task);
    }
  }

  function dropTask(id: string): void {
    tasks.value = tasks.value.filter((item) => item.id !== id);
    const running = new Set(runningIds.value);
    running.delete(id);
    runningIds.value = running;
  }

  /** 首次使用时订阅主进程推送（弹窗打开触发 load，不常驻） */
  function ensureSubscriptions(): void {
    const zen = window.zen;
    if (!zen || unbindChanged) {
      return;
    }
    unbindChanged = zen.scheduler.onChanged((list) => {
      tasks.value = list;
    });
    unbindRunEvent = zen.scheduler.onRunEvent((event: ScheduledTaskRunEvent) => {
      const running = new Set(runningIds.value);
      if (event.state === "started") {
        running.add(event.taskId);
      } else {
        running.delete(event.taskId);
      }
      runningIds.value = running;
    });
  }

  function dispose(): void {
    unbindChanged?.();
    unbindRunEvent?.();
    unbindChanged = null;
    unbindRunEvent = null;
  }

  async function load(): Promise<void> {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    ensureSubscriptions();
    try {
      tasks.value = await zen.scheduler.list();
      loaded.value = true;
      error.value = "";
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function create(input: ScheduledTaskInput): Promise<ScheduledTask | { error: string }> {
    const zen = window.zen;
    if (!zen) {
      return { error: "window.zen unavailable" };
    }
    const result = await zen.scheduler.create(JSON.parse(JSON.stringify(input)) as ScheduledTaskInput);
    if ("error" in result) {
      return result;
    }
    applyTask(result);
    return result;
  }

  async function update(
    id: string,
    patch: Partial<ScheduledTaskInput>,
  ): Promise<ScheduledTask | null | { error: string }> {
    const zen = window.zen;
    if (!zen) {
      return { error: "window.zen unavailable" };
    }
    const result = await zen.scheduler.update(
      id,
      JSON.parse(JSON.stringify(patch)) as Partial<ScheduledTaskInput>,
    );
    if (result && !("error" in result)) {
      applyTask(result);
    }
    return result;
  }

  async function remove(id: string): Promise<void> {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    await zen.scheduler.remove(id);
    dropTask(id);
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    const task = await zen.scheduler.toggle(id, enabled);
    if (task) {
      applyTask(task);
    }
  }

  /** 立即执行一次；主进程立即返回，运行状态经 run-event 更新 */
  async function runNow(id: string): Promise<{ ok: boolean; error?: string }> {
    const zen = window.zen;
    if (!zen) {
      return { ok: false, error: "window.zen unavailable" };
    }
    const result = await zen.scheduler.runNow(id);
    if (result.ok) {
      const running = new Set(runningIds.value);
      running.add(id);
      runningIds.value = running;
    }
    return result;
  }

  function isRunning(id: string): boolean {
    return runningIds.value.has(id);
  }

  return {
    tasks,
    runningIds,
    loaded,
    error,
    count,
    load,
    dispose,
    create,
    update,
    remove,
    toggle,
    runNow,
    isRunning,
  };
});
