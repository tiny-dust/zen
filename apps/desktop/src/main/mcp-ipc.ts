import { ipcMain, shell } from "electron";

import { createMcpClient, runBrowserAuthorization } from "@zen/mcp-client";

import type { McpDiscoveredServer, McpServerConfig, McpServerStatus, McpToolInfo } from "@zen/shared";
import type { McpClient } from "@zen/mcp-client";
import { clearMcpAuthExcept, getValidAccessToken, saveMcpAuthEntry } from "./mcp-auth-store";
import { scanMcpSources } from "./mcp-scan";
import { readMcpConfig, writeMcpConfig } from "./zen-dir";

/**
 * MCP 进程池：按 ~/.zen/mcp.json 管理服务器，惰性连接，工具清单缓存。
 * agent:run 时从这里取已启用 server 的工具桥接进 ToolLoopAgent。
 */

const clients = new Map<string, McpClient>();
const toolsCache = new Map<string, McpToolInfo[]>();
/** 每个 client 建立时的配置签名；同 id 配置变化后据此重启旧进程并作废缓存 */
const configSignatures = new Map<string, string>();

function configSignature(config: McpServerConfig): string {
  return JSON.stringify([
    config.name,
    config.transport,
    config.command ?? "",
    config.args ?? [],
    config.env ?? {},
    config.url ?? "",
    config.headers ?? {},
    config.enabled,
  ]);
}

function dropClient(id: string): void {
  clients.get(id)?.shutdown();
  clients.delete(id);
  toolsCache.delete(id);
  configSignatures.delete(id);
}

function clientFor(config: McpServerConfig): McpClient {
  const signature = configSignature(config);
  const existing = clients.get(config.id);
  if (existing) {
    if (configSignatures.get(config.id) === signature) {
      return existing;
    }
    dropClient(config.id);
  }
  const client = createMcpClient(config);
  clients.set(config.id, client);
  configSignatures.set(config.id, signature);
  return client;
}

/** 远程服务注入已存 OAuth token；本地 stdio 或无凭据时原样返回。token 变化会体现在签名里，从而触发重连 */
async function configWithAuth(config: McpServerConfig): Promise<McpServerConfig> {
  if (config.transport !== "http" && config.transport !== "sse") {
    return config;
  }
  const token = await getValidAccessToken(config.id);
  if (!token) {
    return config;
  }
  return {
    ...config,
    headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
  };
}

async function collectStatuses(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
  return Promise.all(
    servers.map(async (config) => {
      if (!config.enabled) {
        return { config, state: "stopped" as const, tools: [] };
      }
      const client = clientFor(await configWithAuth(config));
      if (!client.isConnected) {
        try {
          await client.connect();
          toolsCache.set(config.id, await client.listTools());
        } catch (error) {
          // 401 挑战单独标 needs-auth，UI 据此展示「去授权」入口而不是普通报错
          if (client.requiresAuth) {
            return { config, state: "needs-auth" as const, error: "需要浏览器授权", tools: [] };
          }
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

/** 同一 serverId 的浏览器授权防重入：往返可能持续数十秒，重复点击复用进行中的 Promise */
const inFlightAuthorizations = new Map<string, Promise<McpServerStatus[]>>();

async function runAuthorization(serverId: string): Promise<McpServerStatus[]> {
  const { servers } = await readMcpConfig();
  const config = servers.find((item) => item.id === serverId);
  if (!config) {
    throw new Error(`MCP 服务不存在: ${serverId}`);
  }
  if (config.transport !== "http" && config.transport !== "sse") {
    throw new Error("本地 stdio 服务无需 OAuth 授权");
  }
  // 401 时 client 里留着 WWW-Authenticate 挑战，传给授权流程可精确匹配 scope/resource
  const challenge = clients.get(serverId)?.authChallenge ?? null;
  const result = await runBrowserAuthorization(config, {
    challenge,
    openExternal: (url) => {
      void shell.openExternal(url);
    },
  });
  await saveMcpAuthEntry(serverId, result.tokens, result.registration);
  // 旧 client 是 401 未授权连接，丢弃后下方 collectStatuses 会带上新 token 惰性重建
  dropClient(serverId);
  const { servers: next } = await readMcpConfig();
  return collectStatuses(next);
}

function authorizeServer(serverId: string): Promise<McpServerStatus[]> {
  const inFlight = inFlightAuthorizations.get(serverId);
  if (inFlight) {
    return inFlight;
  }
  const promise = runAuthorization(serverId).finally(() => {
    inFlightAuthorizations.delete(serverId);
  });
  inFlightAuthorizations.set(serverId, promise);
  return promise;
}

export function registerMcpIpc(): void {
  ipcMain.handle("mcp:list", async (): Promise<McpServerStatus[]> => {
    const { servers } = await readMcpConfig();
    return collectStatuses(servers);
  });

  // 扫描当前仓库与系统里已有的 MCP 配置，供设置页一键导入
  ipcMain.handle(
    "mcp:scan",
    async (_event, workspaceRoot?: string): Promise<McpDiscoveredServer[]> => {
      const { servers } = await readMcpConfig();
      return scanMcpSources(workspaceRoot, servers);
    },
  );

  ipcMain.handle("mcp:set-servers", async (_event, servers: McpServerConfig[]) => {
    if (!Array.isArray(servers)) {
      return [];
    }
    // 关掉被移除/禁用的进程；同 id 但配置变化的也要作废旧进程与缓存，随后按新配置惰性重建
    const nextById = new Map(servers.map((item) => [item.id, item]));
    for (const id of [...clients.keys()]) {
      const next = nextById.get(id);
      const unchanged = next?.enabled && configSignatures.get(id) === configSignature(next);
      if (!unchanged) {
        dropClient(id);
      }
    }
    await writeMcpConfig(servers);
    // 已移除服务的 OAuth 凭据一并清掉，避免 ~/.zen/mcp-auth.json 残留孤儿密文
    await clearMcpAuthExcept(servers.map((item) => item.id));
    return collectStatuses(servers);
  });

  ipcMain.handle("mcp:authorize", (_event, serverId: string): Promise<McpServerStatus[]> => {
    return authorizeServer(serverId);
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
    const client = clientFor(await configWithAuth(config));
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
  const client = clientFor(await configWithAuth(config));
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
  configSignatures.clear();
}
