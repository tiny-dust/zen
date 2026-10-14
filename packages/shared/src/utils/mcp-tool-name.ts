/**
 * MCP 桥接工具的 wire 名（发给模型的工具名）。
 * Anthropic 等协议要求工具名匹配 ^[a-zA-Z0-9_-]+$（不允许点号），
 * 因此 mcp.<server>.<tool> 三段名净化为 mcp__<server>__<tool> 过线。
 */

export const MCP_TOOL_NAME_PREFIX = "mcp__";

/** Anthropic Messages API 工具名长度上限 */
export const MCP_TOOL_NAME_MAX = 64;

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 组装 wire 工具名：非法字符替换为 _，超长截断（截断撞名由注册方去重） */
export function mcpToolWireName(serverName: string, toolName: string): string {
  const name = `${MCP_TOOL_NAME_PREFIX}${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`;
  return name.length <= MCP_TOOL_NAME_MAX ? name : name.slice(0, MCP_TOOL_NAME_MAX);
}

export interface McpToolNameParts {
  serverName: string;
  toolName: string;
}

/**
 * 解析 mcp__<server>__<tool> wire 名；非该前缀或缺少任一段返回 null。
 * 段内原有的点号等字符在净化时已被替换为 _，无法精确还原，仅用于展示与分组。
 */
export function parseMcpToolName(toolName: string): McpToolNameParts | null {
  if (!toolName.startsWith(MCP_TOOL_NAME_PREFIX)) {
    return null;
  }
  const rest = toolName.slice(MCP_TOOL_NAME_PREFIX.length).split("__");
  const serverName = rest[0] ?? "";
  const tool = rest.slice(1).join("__");
  if (!serverName || !tool) {
    return null;
  }
  return { serverName, toolName: tool };
}

/** 是否 MCP 桥接工具的 wire 名 */
export function isMcpToolName(toolName: string): boolean {
  return parseMcpToolName(toolName) !== null;
}
