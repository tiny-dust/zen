import { ipcRenderer } from "electron";

import type { UpdateStatusInfo } from "@zen/shared";

export const updatesApi = {
  updates: {
    check(): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("update:check");
    },
    download(): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("update:download");
    },
    install(): void {
      void ipcRenderer.invoke("update:install");
    },
    onStatus(handler: (status: UpdateStatusInfo) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatusInfo) => {
        handler(status);
      };
      ipcRenderer.on("update:status", listener);
      return () => {
        ipcRenderer.removeListener("update:status", listener);
      };
    },
  },
};
