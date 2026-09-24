import { ipcRenderer } from "electron";

import type { AgentServiceInfo } from "@zen/shared";

export const servicesApi = {
  services: {
    list(): Promise<AgentServiceInfo[]> {
      return ipcRenderer.invoke("services:list");
    },
    kill(id: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("services:kill", id);
    },
    onChange(handler: (services: AgentServiceInfo[]) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentServiceInfo[]) => {
        handler(payload);
      };
      ipcRenderer.on("services:changed", listener);
      return () => {
        ipcRenderer.removeListener("services:changed", listener);
      };
    },
  },
};
