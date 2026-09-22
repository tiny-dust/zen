export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  /** stdio：启动命令与参数 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** sse / http：远程服务地址 */
  url?: string;
  /** sse / http：附加请求头（如 Authorization: Bearer <token>） */
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolInfo {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** 扫描仓库/系统已有 MCP 配置发现的服务（mcp:scan） */
export interface McpDiscoveredServer {
  config: McpServerConfig;
  /** 来源展示名，如「当前仓库 (.mcp.json)」「Claude Desktop」 */
  source: string;
  /** 配置文件绝对路径 */
  sourcePath: string;
  /** 与 ~/.zen/mcp.json 已有条目重复 */
  alreadyImported: boolean;
}
