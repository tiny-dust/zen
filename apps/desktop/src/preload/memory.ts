import { ipcRenderer } from "electron";

import type { MemoryScope, MemorySnapshot } from "@zen/shared";

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
  },
};
