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
