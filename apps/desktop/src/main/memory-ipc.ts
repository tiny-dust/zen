import { ipcMain } from "electron";

import type {
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemorySnapshot,
} from "@zen/shared";

import {
  appendMemoryNote,
  applyMemoryConsolidation,
  collectDeviceMemory,
  consolidateMemory,
  readMemorySnapshot,
  removeMemoryNote,
} from "./memory";

/**
 * 记忆域 IPC：~/.zen/memory 的读取、备注增删、设备快照重采与记忆整固。
 * 设备/用户两域共用 scope 参数区分；整固先预览 diff，用户确认后才原子写回。
 */

function asScope(value: unknown): MemoryScope | null {
  return value === "device" || value === "user" ? value : null;
}

/** IPC 边界清洗：只接受纯值数组，字段缺省/超长/超量由 normalizeNotes 兜底 */
function asNotes(value: unknown): MemoryNote[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((note) => ({
    id: typeof (note as MemoryNote)?.id === "string" ? (note as MemoryNote).id : "",
    text: typeof (note as MemoryNote)?.text === "string" ? (note as MemoryNote).text : "",
    createdAt: Number((note as MemoryNote)?.createdAt) || 0,
  }));
}

export function registerMemoryIpc(): void {
  ipcMain.handle("memory:get", async (): Promise<MemorySnapshot> => {
    return readMemorySnapshot();
  });

  ipcMain.handle(
    "memory:add-note",
    async (_event, scope: unknown, text: unknown): Promise<MemorySnapshot> => {
      const validScope = asScope(scope);
      if (!validScope || typeof text !== "string" || !text.trim()) {
        return readMemorySnapshot();
      }
      return appendMemoryNote(validScope, text);
    },
  );

  ipcMain.handle(
    "memory:remove-note",
    async (_event, scope: unknown, id: unknown): Promise<MemorySnapshot> => {
      const validScope = asScope(scope);
      if (!validScope || typeof id !== "string") {
        return readMemorySnapshot();
      }
      return removeMemoryNote(validScope, id);
    },
  );

  ipcMain.handle("memory:collect", async (): Promise<MemorySnapshot> => {
    await collectDeviceMemory();
    return readMemorySnapshot();
  });

  // 整固预览：调模型算 diff，不落盘；失败也返回 {ok:false}（不 reject，便于 UI 内联提示）
  ipcMain.handle(
    "memory:consolidate-preview",
    async (_event, scope: unknown): Promise<MemoryConsolidationResult> => {
      const validScope = asScope(scope);
      if (!validScope) {
        return {
          ok: false,
          error: "invalid scope",
          scope: "user",
          before: [],
          after: [],
          changedCount: 0,
        };
      }
      return consolidateMemory(validScope);
    },
  );

  // 应用整固：把预览确认过的 notes 原子写回；scope/notes 不合法时不动原始数据
  ipcMain.handle(
    "memory:apply",
    async (_event, scope: unknown, notes: unknown): Promise<MemorySnapshot> => {
      const validScope = asScope(scope);
      const validNotes = asNotes(notes);
      if (!validScope || !validNotes) {
        return readMemorySnapshot();
      }
      return applyMemoryConsolidation(validScope, validNotes);
    },
  );
}
