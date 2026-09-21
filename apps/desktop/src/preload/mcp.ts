import { ipcRenderer } from "electron";

import type { McpServerConfig, McpServerStatus } from "@zen/shared";

export const mcpApi = {
  mcp: {
    list(): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:list");
    },
    setServers(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:set-servers", servers);
    },
  },
};
