import { ipcMain } from "electron";

import type { AgentServiceInfo } from "@zen/shared";
import type { AgentServicesRegistry } from "./agent-services";
import { readProcessStats } from "./process-stats";

export function registerAgentServicesIpc(registry: AgentServicesRegistry): void {
  ipcMain.handle("services:list", (): Promise<AgentServiceInfo[]> => registry.list());

  /** 看板进程指标：只回真实采样到的 pid；读不到由 UI 显示不可用 */
  ipcMain.handle("services:stats", async (_event, pids: unknown) => {
    if (!Array.isArray(pids)) {
      return [];
    }
    return readProcessStats(pids.filter((pid): pid is number => typeof pid === "number"));
  });

  ipcMain.handle("services:kill", async (_event, id: string) => {
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: "invalid service id" };
    }
    return registry.kill(id);
  });
}
