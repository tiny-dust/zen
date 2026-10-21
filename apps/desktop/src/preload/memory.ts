import { ipcRenderer } from "electron";

import type { MemoryConsolidationResult, MemoryScope, MemorySnapshot } from "@zen/shared";

export const memoryApi = {
  memory: {
    get(): Promise<MemorySnapshot> {
      return ipcRenderer.invoke("memory:get");
    },
    addNote(scope: MemoryScope, text: string): Promise<MemorySnapshot> {
      return ipcRenderer.invoke("memory:add-note", scope, text);
    },
    removeNote(scope: MemoryScope, id: string): Promise<MemorySnapshot> {
      return ipcRenderer.invoke("memory:remove-note", scope, id);
    },
    collect(): Promise<MemorySnapshot> {
      return ipcRenderer.invoke("memory:collect");
    },
    /** 整固预览：调模型算 diff，不落盘；失败返回 {ok:false, error} */
    consolidatePreview(scope: MemoryScope): Promise<MemoryConsolidationResult> {
      return ipcRenderer.invoke("memory:consolidate-preview", scope);
    },
    /** 应用整固：把预览确认过的 notes 原子写回 */
    applyConsolidation(
      scope: MemoryScope,
      notes: Array<{ id: string; text: string; createdAt: number }>,
    ): Promise<MemorySnapshot> {
      return ipcRenderer.invoke("memory:apply", scope, notes);
    },
  },
};
