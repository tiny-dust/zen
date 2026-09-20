import { ipcMain } from "electron";

import { createMcpClient } from "@zen/mcp-client";

import type { McpServerConfig, McpServerStatus, McpToolInfo } from "@zen/shared";
import type { McpClient } from "@zen/mcp-client";
import { readMcpConfig, writeMcpConfig } from "./zen-dir";

/**
 * MCP 进程池：按 ~/.zen/mcp.json 管理服务器，惰性连接，工具清单缓存。
 * agent:run 时从这里取已启用 server 的工具桥接进 ToolLoopAgent。
 */

const clients = new Map<string, McpClient>();
const toolsCache = new Map<string, McpToolInfo[]>();

function clientFor(config: McpServerConfig): McpClient {
  const existing = clients.get(config.id);
  if (existing) {
    return existing;
  }
  const client = createMcpClient(config);
  clients.set(config.id, client);
  return client;
}

async function collectStatuses(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
  return Promise.all(
    servers.map(async (config) => {
      if (!config.enabled) {
        return { config, state: "stopped" as const, tools: [] };
      }
      const client = clientFor(config);
      if (!client.isConnected) {
        try {
          await client.connect();
          toolsCache.set(config.id, await client.listTools());
        } catch (error) {
          return {
            config,
            state: "error" as const,
            error: error instanceof Error ? error.message : String(error),
            tools: [],
          };
        }
      }
      return { config, state: "running" as const, tools: toolsCache.get(config.id) ?? [] };
    }),
  );
}

export function registerMcpIpc(): void {
  ipcMain.handle("mcp:list", async (): Promise<McpServerStatus[]> => {
    const { servers } = await readMcpConfig();
    return collectStatuses(servers);
  });

  ipcMain.handle("mcp:set-servers", async (_event, servers: McpServerConfig[]) => {
    if (!Array.isArray(servers)) {
      return [];
    }
    // 关掉被移除/禁用的进程
    const keep = new Set(servers.filter((item) => item.enabled).map((item) => item.id));
    for (const [id, client] of clients) {
      if (!keep.has(id)) {
        client.shutdown();
        clients.delete(id);
        toolsCache.delete(id);
      }
    }
    await writeMcpConfig(servers);
    return collectStatuses(servers);
  });
}

/** 已启用 server 的工具桥接描述（agent:run 组装 ToolSet 用，带 serverName） */
export async function enabledMcpTools(): Promise<
  Array<{
    serverId: string;
    serverName: string;
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>
> {
  const { servers } = await readMcpConfig();
  const tools: Array<{
    serverId: string;
    serverName: string;
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }> = [];
  for (const config of servers) {
    if (!config.enabled) {
      continue;
    }
    const client = clientFor(config);
    try {
      if (!client.isConnected) {
        await client.connect();
      }
      const cached = toolsCache.get(config.id);
      if (cached) {
        tools.push(...cached.map((tool) => ({ ...tool, serverName: config.name })));
      } else {
        const fresh = await client.listTools();
        toolsCache.set(config.id, fresh);
        tools.push(...fresh.map((tool) => ({ ...tool, serverName: config.name })));
      }
    } catch {
      // 单个 server 失败不阻塞其他 server
    }
  }
  return tools;
}

/** 按 "mcp.<serverName>.<toolName>" 调用（serverName 是配置里的 name 字段） */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: unknown,
): Promise<{ ok: boolean; text: string; error?: string }> {
  const { servers } = await readMcpConfig();
  const config = servers.find((item) => item.enabled && item.name === serverName);
  if (!config) {
    return { ok: false, text: "", error: `MCP server 不存在或未启用: ${serverName}` };
  }
  const client = clientFor(config);
  if (!client.isConnected) {
    await client.connect();
  }
  return client.callTool(toolName, args);
}

export function shutdownMcp(): void {
  for (const client of clients.values()) {
    client.shutdown();
  }
  clients.clear();
  toolsCache.clear();
}
