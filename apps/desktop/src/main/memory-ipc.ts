import { ipcMain } from "electron";

import { MEMORY_CATEGORIES } from "@zen/shared";
import type {
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemoryView,
} from "@zen/shared";

import {
  appendMemoryNote,
  applyMemoryConsolidation,
  collectDeviceMemory,
  consolidateMemory,
  readMemoryNotes,
  readMemoryView,
  removeMemoryNote,
  toMemoryView,
} from "./memory";

/**
 * 记忆域 IPC：~/.zen/memory 的读取、备注增删、设备快照重采与记忆整固。
 * 设备/用户两域共用 scope 参数区分；整固先预览 diff，用户确认后才原子写回。
 */

function asScope(value: unknown): MemoryScope | null {
  return value === "device" || value === "user" ? value : null;
}

/** 分类参数：缺省 / 非法值都视为「全部」，不做错误处理 */
function asCategory(value: unknown): MemoryCategory | undefined {
  return typeof value === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(value)
    ? (value as MemoryCategory)
    : undefined;
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
  // 记忆视图：设备备注只给分类索引，正文走 memory:notes 按需读取
  ipcMain.handle("memory:get", async (): Promise<MemoryView> => {
    return readMemoryView();
  });

  // 按分类读取备注正文（设置页展开某类 / Agent readMemory 工具共用）
  ipcMain.handle(
    "memory:notes",
    async (_event, scope: unknown, category: unknown): Promise<MemoryNote[]> => {
      const validScope = asScope(scope);
      if (!validScope) {
        return [];
      }
      return readMemoryNotes(validScope, asCategory(category));
    },
  );

  ipcMain.handle(
    "memory:add-note",
    async (
      _event,
      scope: unknown,
      text: unknown,
      category: unknown,
    ): Promise<MemoryView> => {
      const validScope = asScope(scope);
      if (!validScope || typeof text !== "string" || !text.trim()) {
        return readMemoryView();
      }
      return toMemoryView(await appendMemoryNote(validScope, text, asCategory(category)));
    },
  );

  ipcMain.handle(
    "memory:remove-note",
    async (_event, scope: unknown, id: unknown): Promise<MemoryView> => {
      const validScope = asScope(scope);
      if (!validScope || typeof id !== "string") {
        return readMemoryView();
      }
      return toMemoryView(await removeMemoryNote(validScope, id));
    },
  );

  ipcMain.handle("memory:collect", async (): Promise<MemoryView> => {
    await collectDeviceMemory();
    return readMemoryView();
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
    async (_event, scope: unknown, notes: unknown): Promise<MemoryView> => {
      const validScope = asScope(scope);
      const validNotes = asNotes(notes);
      if (!validScope || !validNotes) {
        return readMemoryView();
      }
      return toMemoryView(await applyMemoryConsolidation(validScope, validNotes));
    },
  );
}
