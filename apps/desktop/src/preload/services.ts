import { ipcRenderer } from "electron";

import type { AgentServiceInfo, ProcessStat } from "@zen/shared";

export const servicesApi = {
  services: {
    list(): Promise<AgentServiceInfo[]> {
      return ipcRenderer.invoke("services:list");
    },
    /** 进程指标采样：返回真实读到的进程，缺失的 pid 不在结果里 */
    stats(pids: number[]): Promise<ProcessStat[]> {
      return ipcRenderer.invoke("services:stats", pids);
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
