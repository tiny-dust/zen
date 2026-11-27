import { ipcMain } from "electron";

import {
  acceptTask,
  ackTask,
  archiveTask,
  cancelTask,
  createTask,
  decideTask,
  getTaskDetail,
  listTasks,
  pauseTask,
  rejectTask,
  removeTask,
  resumeTask,
  runTaskNow,
  shutdownTasks,
  startTasksService,
  taskJournal,
  unarchiveTask,
  updateTask,
} from "./tasks/service";

import type { AgentSession } from "@zen/agent-core";
import type { Task, TaskJournalEntry, TaskListResult, TaskQueueInfo, TaskAttempt } from "@zen/shared";

export { shutdownTasks };

/**
 * 持续任务 IPC（channel 与 preload/tasks.ts 一一对应）。
 * 入参一律按 unknown 收：非法就返回 null / { error }，不放异常到渲染层。
 */

function taskId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    console.warn("[zen] 任务操作失败", error);
    return fallback;
  }
}

function simpleCommand(
  channel: string,
  run: (id: string) => Task | null,
): void {
  ipcMain.handle(channel, (_event, id: unknown) => {
    const task = taskId(id);
    if (!task) {
      return null;
    }
    return safely(() => run(task), null);
  });
}

export function registerTasksIpc(
  broadcast: (channel: string, payload: unknown) => void,
  sessions: Map<string, AgentSession>,
): void {
  startTasksService(broadcast, sessions);

  ipcMain.handle("tasks:list", (): TaskListResult => {
    return safely(() => listTasks(), { tasks: [], queue: {} });
  });

  ipcMain.handle(
    "tasks:get",
    (
      _event,
      id: unknown,
    ): { task: Task; attempts: TaskAttempt[]; queue?: TaskQueueInfo } | null => {
      const task = taskId(id);
      if (!task) {
        return null;
      }
      return safely(() => getTaskDetail(task), null);
    },
  );

  ipcMain.handle("tasks:journal", (_event, id: unknown): TaskJournalEntry[] => {
    const task = taskId(id);
    if (!task) {
      return [];
    }
    return safely(() => taskJournal(task), []);
  });

  ipcMain.handle("tasks:create", (_event, input: unknown) => {
    return safely(() => createTask(input), { error: "cannot create task" });
  });

  ipcMain.handle("tasks:update", (_event, patch: unknown) => {
    return safely(() => updateTask(patch), { error: "cannot update task" });
  });

  ipcMain.handle("tasks:run-now", (_event, id: unknown) => {
    const task = taskId(id);
    if (!task) {
      return { ok: false, error: "invalid task id" };
    }
    return safely(() => runTaskNow(task), { ok: false, error: "cannot run task" });
  });

  simpleCommand("tasks:pause", pauseTask);
  simpleCommand("tasks:resume", resumeTask);
  simpleCommand("tasks:cancel", cancelTask);
  simpleCommand("tasks:accept", acceptTask);
  simpleCommand("tasks:archive", archiveTask);
  simpleCommand("tasks:unarchive", unarchiveTask);
  simpleCommand("tasks:ack", ackTask);

  ipcMain.handle("tasks:reject", (_event, id: unknown, feedback: unknown) => {
    const task = taskId(id);
    if (!task) {
      return null;
    }
    return safely(
      () => rejectTask(task, typeof feedback === "string" ? feedback : ""),
      null,
    );
  });

  ipcMain.handle("tasks:decide", (_event, id: unknown, _approve: unknown, text: unknown) => {
    const task = taskId(id);
    if (!task) {
      return null;
    }
    return safely(
      () => decideTask(task, typeof text === "string" ? text : undefined),
      null,
    );
  });

  ipcMain.handle("tasks:remove", (_event, id: unknown) => {
    const task = taskId(id);
    if (!task) {
      return { ok: false };
    }
    return { ok: safely(() => removeTask(task), false) };
  });
}
