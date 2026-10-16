import { ipcRenderer } from "electron";

import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunEvent,
} from "@zen/shared";

/** 定时/计划任务：任务 CRUD、运行历史、立即执行与状态变化订阅 */
export const schedulerApi = {
  scheduler: {
    list(): Promise<ScheduledTask[]> {
      return ipcRenderer.invoke("scheduler:list");
    },
    listRuns(taskId: string): Promise<ScheduledTaskRun[]> {
      return ipcRenderer.invoke("scheduler:list-runs", taskId);
    },
    create(input: ScheduledTaskInput): Promise<ScheduledTask | { error: string }> {
      return ipcRenderer.invoke("scheduler:create", input);
    },
    update(
      id: string,
      patch: Partial<ScheduledTaskInput>,
    ): Promise<ScheduledTask | null | { error: string }> {
      return ipcRenderer.invoke("scheduler:update", id, patch);
    },
    remove(id: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("scheduler:remove", id);
    },
    toggle(id: string, enabled: boolean): Promise<ScheduledTask | null> {
      return ipcRenderer.invoke("scheduler:toggle", id, enabled);
    },
    /** 立即执行一次（不看 enabled 与调度周期），运行状态走 onRunEvent */
    runNow(id: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("scheduler:run-now", id);
    },
    onChanged(handler: (tasks: ScheduledTask[]) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, tasks: ScheduledTask[]) => {
        handler(tasks);
      };
      ipcRenderer.on("scheduler:changed", listener);
      return () => {
        ipcRenderer.removeListener("scheduler:changed", listener);
      };
    },
    onRunEvent(handler: (event: ScheduledTaskRunEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, run: ScheduledTaskRunEvent) => {
        handler(run);
      };
      ipcRenderer.on("scheduler:run-event", listener);
      return () => {
        ipcRenderer.removeListener("scheduler:run-event", listener);
      };
    },
  },
};
