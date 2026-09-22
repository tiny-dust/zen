import { ipcMain } from "electron";

import type { MemoryScope, MemorySnapshot } from "@zen/shared";

import {
  appendMemoryNote,
  collectDeviceMemory,
  readMemorySnapshot,
  removeMemoryNote,
} from "./memory";

/**
 * 记忆域 IPC：~/.zen/memory 的读取、备注增删、设备快照重采。
 * 设备/用户两域共用 scope 参数区分。
 */

function asScope(value: unknown): MemoryScope | null {
  return value === "device" || value === "user" ? value : null;
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
}
