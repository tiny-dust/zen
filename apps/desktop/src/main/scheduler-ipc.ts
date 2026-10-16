import { ipcMain } from "electron";

import {
  createScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  removeScheduledTask,
  runScheduledTaskNow,
  setScheduledTaskEnabled,
  startScheduler,
  updateScheduledTask,
} from "./scheduler";

export { shutdownScheduler } from "./scheduler";

import type { AgentSession } from "@zen/agent-core";
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRun } from "@zen/shared";

/**
 * 定时任务 IPC：list / list-runs / create / update / remove / toggle / run-now。
 * 任务状态变化经 broadcast 推送（scheduler:changed 全量列表 + scheduler:run-event 运行事件）。
 */
export function registerSchedulerIpc(
  broadcast: (channel: string, payload: unknown) => void,
  sessions: Map<string, AgentSession>,
): void {
  startScheduler(broadcast, sessions);

  ipcMain.handle("scheduler:list", (): ScheduledTask[] => listScheduledTasks());

  ipcMain.handle("scheduler:list-runs", (_event, id: string): ScheduledTaskRun[] => {
    if (typeof id !== "string" || !id) {
      return [];
    }
    return listScheduledTaskRuns(id);
  });

  ipcMain.handle("scheduler:create", (_event, input: Partial<ScheduledTaskInput>) => {
    return createScheduledTask(input);
  });

  ipcMain.handle("scheduler:update", (_event, id: string, patch: Partial<ScheduledTaskInput>) => {
    if (typeof id !== "string" || !id) {
      return { error: "invalid task id" };
    }
    return updateScheduledTask(id, patch);
  });

  ipcMain.handle("scheduler:remove", (_event, id: string) => {
    if (typeof id !== "string" || !id) {
      return { ok: false };
    }
    return { ok: removeScheduledTask(id) };
  });

  ipcMain.handle("scheduler:toggle", (_event, id: string, enabled: boolean) => {
    if (typeof id !== "string" || !id || typeof enabled !== "boolean") {
      return null;
    }
    return setScheduledTaskEnabled(id, enabled);
  });

  ipcMain.handle("scheduler:run-now", (_event, id: string) => {
    if (typeof id !== "string" || !id) {
      return { ok: false, error: "invalid task id" };
    }
    return runScheduledTaskNow(id);
  });
}
