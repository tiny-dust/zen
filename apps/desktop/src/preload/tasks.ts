import { ipcRenderer } from "electron";

import type {
  Task,
  TaskAttempt,
  TaskInput,
  TaskJournalEntry,
  TaskListResult,
  TaskQueueInfo,
  TaskStreamEvent,
} from "@zen/shared";

/**
 * 持续任务：CRUD、执行控制（运行 / 暂停 / 取消 / 验收 / 退回 / 归档）、
 * 执行记录与事件日志、实时事件订阅。channels 与 main 侧 tasks-ipc.ts 一一对应。
 */
export const tasksApi = {
  tasks: {
    list(): Promise<TaskListResult> {
      return ipcRenderer.invoke("tasks:list");
    },
    get(id: string): Promise<{ task: Task; attempts: TaskAttempt[]; queue?: TaskQueueInfo } | null> {
      return ipcRenderer.invoke("tasks:get", id);
    },
    journal(id: string): Promise<TaskJournalEntry[]> {
      return ipcRenderer.invoke("tasks:journal", id);
    },
    create(input: TaskInput): Promise<Task | { error: string }> {
      return ipcRenderer.invoke("tasks:create", input);
    },
    update(patch: { id: string } & Partial<TaskInput>): Promise<Task | { error: string }> {
      return ipcRenderer.invoke("tasks:update", patch);
    },
    runNow(id: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("tasks:run-now", id);
    },
    pause(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:pause", id);
    },
    resume(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:resume", id);
    },
    cancel(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:cancel", id);
    },
    accept(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:accept", id);
    },
    reject(id: string, feedback: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:reject", id, feedback);
    },
    archive(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:archive", id);
    },
    unarchive(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:unarchive", id);
    },
    ack(id: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:ack", id);
    },
    remove(id: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("tasks:remove", id);
    },
    /** 等审批/补充信息时回答：approve + 可选文本 */
    decide(id: string, approve: boolean, text?: string): Promise<Task | null> {
      return ipcRenderer.invoke("tasks:decide", id, approve, text);
    },
    onEvent(handler: (event: TaskStreamEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: TaskStreamEvent) => {
        handler(payload);
      };
      ipcRenderer.on("tasks:event", listener);
      return () => {
        ipcRenderer.removeListener("tasks:event", listener);
      };
    },
  },
};
