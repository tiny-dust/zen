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

/**
 * MCP Apps（SEP-1865）：MCP server 在工具结果里返回的交互式 HTML 资源。
 * 工具 output 为该形状时，渲染层用沙箱 iframe 展示 html，output 字段是给模型看的文本结果。
 */
export interface McpAppToolOutput {
  /** 给模型看的文本结果（与无 HTML 时的工具输出一致） */
  output?: string;
  /** 沙箱 iframe 渲染的交互式 HTML（srcdoc 注入，不加载任意外链） */
  html: string;
}

/** 工具输出是否为 MCP Apps 交互资源（非空 html 即命中） */
export function isMcpAppOutput(value: unknown): value is McpAppToolOutput {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const html = (value as { html?: unknown }).html;
  return typeof html === "string" && html.trim().length > 0;
}
