import { ipcRenderer } from "electron";

import type { McpDiscoveredServer, McpServerConfig, McpServerStatus } from "@zen/shared";

export const mcpApi = {
  mcp: {
    list(): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:list");
    },
    scan(workspaceRoot?: string): Promise<McpDiscoveredServer[]> {
      return ipcRenderer.invoke("mcp:scan", workspaceRoot);
    },
    setServers(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:set-servers", servers);
    },
  },
};
