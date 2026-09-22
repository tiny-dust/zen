import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { McpServerConfig, McpTransport } from "@zen/shared";

/**
 * 扫描当前仓库与系统里已有的 MCP 服务配置（Claude Code / Claude Desktop /
 * Cursor / Windsurf / VS Code），转换为 Zen 的 server 配置供一键导入。
 * 各来源文件格式遵循各自约定：{ mcpServers: {...} }（Claude 系）、
 * { servers: {...} }（VS Code 新版）或顶层 map。
 */

export interface McpDiscoveredServer {
  config: McpServerConfig;
  /** 来源展示名，如「当前仓库 (.mcp.json)」「Claude Desktop」 */
  source: string;
  /** 配置文件绝对路径 */
  sourcePath: string;
  /** 与 ~/.zen/mcp.json 已有条目重复（按名称或命令+参数 / URL 判定） */
  alreadyImported: boolean;
}

interface RawMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** 传输类型标记：stdio / sse / http（streamable-http 变体也归 http） */
  type?: string;
}

type RawMap = Record<string, RawMcpEntry>;

function detectTransport(entry: RawMcpEntry): McpTransport | null {
  if (entry.command) {
    return "stdio";
  }
  if (entry.url) {
    const type = entry.type?.toLowerCase();
    if (type === "sse") {
      return "sse";
    }
    if (type === "http" || type === "streamable-http" || type === "streamable_http") {
      return "http";
    }
    // 未标注类型时按 URL 形态猜（/sse 结尾 → SSE 旧版，其余 → HTTP 新版）
    return /\/sse\/?($|\?)/i.test(entry.url) ? "sse" : "http";
  }
  return null;
}

function toConfig(id: string, name: string, entry: RawMcpEntry): McpServerConfig | null {
  const transport = detectTransport(entry);
  if (!transport) {
    return null;
  }
  if (transport === "stdio") {
    if (!entry.command) {
      return null;
    }
    return {
      id,
      name,
      transport,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env,
      enabled: true,
    };
  }
  return {
    id,
    name,
    transport,
    url: entry.url,
    headers: entry.headers,
    enabled: true,
  };
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 从 JSON 里提取 server map：mcpServers / servers 键优先，否则视为顶层 map */
function extractServerMap(data: unknown): RawMap {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const record = data as Record<string, unknown>;
  for (const key of ["mcpServers", "servers"]) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as RawMap;
    }
  }
  return record as RawMap;
}

/** 按平台列出候选配置文件（仓库级 + 各客户端用户级） */
function candidateFiles(workspaceRoot?: string): Array<{ path: string; source: string }> {
  const home = homedir();
  const list: Array<{ path: string; source: string }> = [];
  if (workspaceRoot) {
    list.push({ path: join(workspaceRoot, ".mcp.json"), source: "当前仓库 (.mcp.json)" });
    list.push({ path: join(workspaceRoot, ".vscode", "mcp.json"), source: "当前仓库 (.vscode/mcp.json)" });
  }
  list.push({ path: join(home, ".claude.json"), source: "Claude Code" });
  list.push({
    path:
      process.platform === "darwin"
        ? join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : process.platform === "win32"
          ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
          : join(home, ".config", "Claude", "claude_desktop_config.json"),
    source: "Claude Desktop",
  });
  list.push({ path: join(home, ".cursor", "mcp.json"), source: "Cursor" });
  list.push({
    path: join(home, ".codeium", "windsurf", "mcp_config.json"),
    source: "Windsurf",
  });
  list.push({
    path:
      process.platform === "darwin"
        ? join(home, "Library/Application Support/Code/User/mcp.json")
        : process.platform === "win32"
          ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Code", "User", "mcp.json")
          : join(home, ".config", "Code", "User", "mcp.json"),
    source: "VS Code",
  });
  return list;
}

function sameEndpoint(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.transport === "stdio" && b.transport === "stdio") {
    return (
      a.command === b.command &&
      (a.args?.join(" ") ?? "") === (b.args?.join(" ") ?? "")
    );
  }
  if (a.transport !== "stdio" && b.transport !== "stdio") {
    return a.url === b.url;
  }
  return false;
}

export async function scanMcpSources(
  workspaceRoot?: string,
  existing: McpServerConfig[] = [],
): Promise<McpDiscoveredServer[]> {
  const results: McpDiscoveredServer[] = [];
  // 跨来源去重：同一名字 + 同一端点的定义只保留第一次出现
  const seenKeys = new Set<string>();

  for (const { path, source } of candidateFiles(workspaceRoot)) {
    const data = await readJsonFile(path);
    if (!data) {
      continue;
    }
    const map = extractServerMap(data);
    for (const [name, entry] of Object.entries(map)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const config = toConfig(`${name}-${Date.now().toString(36)}`, name, entry);
      if (!config) {
        continue;
      }
      const key = `${name}|${config.transport}|${
        config.transport === "stdio"
          ? [config.command, ...(config.args ?? [])].join(" ")
          : config.url ?? ""
      }`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      const alreadyImported = existing.some(
        (item) => item.name === name || sameEndpoint(item, config),
      );
      results.push({ config, source, sourcePath: path, alreadyImported });
    }
  }
  return results;
}
