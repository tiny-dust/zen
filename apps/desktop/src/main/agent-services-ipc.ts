import { ipcMain } from "electron";

import type { AgentServiceInfo } from "@zen/shared";
import type { AgentServicesRegistry } from "./agent-services";

export function registerAgentServicesIpc(registry: AgentServicesRegistry): void {
  ipcMain.handle("services:list", (): Promise<AgentServiceInfo[]> => registry.list());

  ipcMain.handle("services:kill", async (_event, id: string) => {
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: "invalid service id" };
    }
    return registry.kill(id);
  });
}
