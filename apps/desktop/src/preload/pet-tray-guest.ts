import { contextBridge, ipcRenderer } from "electron";

import type { PetTrayAction } from "../main/pet-tray-window";

contextBridge.exposeInMainWorld("zen", {
  petTray: {
    hide: (): Promise<void> => ipcRenderer.invoke("pet:tray-close"),
    openSession: (sessionId: string): Promise<void> => ipcRenderer.invoke("pet:tray-open-session", sessionId),
    control: async (action: PetTrayAction): Promise<void> => {
      const result = await ipcRenderer.invoke("pet:tray-action", action) as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error ?? "操作失败");
    },
  },
});
