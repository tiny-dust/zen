/**
 * Zen 桌面端 MCP 客户端：统一面覆盖三种传输方式。
 * - stdio：本地子进程，行分隔 JSON-RPC（McpStdioClient）
 * - sse：HTTP+SSE 旧版远程协议（McpHttpClient）
 * - http：Streamable HTTP 新版远程协议（McpHttpClient）
 */

import { McpHttpClient } from "./http";
import { McpStdioClient } from "./stdio";

import type { McpClient } from "./base";
import type { McpServerConfig } from "@zen/shared";

export { McpStdioClient } from "./stdio";
export { McpHttpClient } from "./http";
export type { McpClient, McpCallResult, JsonRpcMessage } from "./base";

/** 按配置的传输方式创建客户端 */
export function createMcpClient(config: McpServerConfig): McpClient {
  return config.transport === "stdio" ? new McpStdioClient(config) : new McpHttpClient(config);
}
