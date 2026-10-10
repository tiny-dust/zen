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
    /** 远程服务需要 OAuth 时触发浏览器授权；成功返回刷新后的状态列表 */
    authorize(serverId: string): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:authorize", serverId);
    },
  },
};
