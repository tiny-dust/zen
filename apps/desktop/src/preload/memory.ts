import { ipcRenderer } from "electron";

import type {
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemoryView,
} from "@zen/shared";

export const memoryApi = {
  memory: {
    /** 设备域只含分类索引（数量 + 摘要），正文走 notes() 按需读取 */
    get(): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:get");
    },
    /** 按分类读取备注正文（category 缺省 = 该域全部） */
    notes(scope: MemoryScope, category?: MemoryCategory): Promise<MemoryNote[]> {
      return ipcRenderer.invoke("memory:notes", scope, category);
    },
    addNote(scope: MemoryScope, text: string, category?: MemoryCategory): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:add-note", scope, text, category);
    },
    removeNote(scope: MemoryScope, id: string): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:remove-note", scope, id);
    },
    collect(): Promise<MemoryView> {
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
    ): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:apply", scope, notes);
    },
  },
};
