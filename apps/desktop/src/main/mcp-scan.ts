import { readFile } from "node:fs/promises";

import type { McpDiscoveredServer, McpServerConfig } from "@zen/shared";
import {
  extractServerMap,
  parseJsonc,
  parseToml,
  toConfig,
  toEntryList,
  type RawMap,
} from "./mcp-scan-parse";
import {
  buildCandidates,
  defaultScanContext,
  type ScanContext,
  type SourceCandidate,
} from "./mcp-scan-providers";

/**
 * 扫描本机与当前仓库里其它 AI 工具已配置的 MCP 服务，转换为 Zen 的 server 配置供一键导入。
 * 覆盖：OpenAI Codex CLI / Claude Code / Claude Desktop / Cursor / VS Code（含 Insiders、
 * profiles）/ Windsurf / Trae / Gemini CLI / MiMo（MiMoCode）/ DimAgent，以及项目级
 * .mcp.json、.cursor/mcp.json、.vscode/mcp.json、.gemini/settings.json、.mimocode/*。
 * 各来源格式：{ mcpServers | servers | mcp: {...} }（JSON/JSONC）或 [mcp_servers.*]（TOML）。
 * 坏文件/坏条目跳过不崩；跨来源按「名称 + 端点」去重合并。
 */

export type { McpDiscoveredServer } from "@zen/shared";

function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function makeId(name: string, sourcePath: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "server";
  return `${slug}-${shortHash(sourcePath)}`;
}

async function readServerMap(candidate: SourceCandidate): Promise<RawMap | null> {
  let text: string;
  try {
    text = await readFile(candidate.path, "utf8");
  } catch {
    return null;
  }
  try {
    const data =
      candidate.format === "toml" ? parseToml(text) : candidate.format === "jsonc" ? parseJsonc(text) : (JSON.parse(text) as unknown);
    return extractServerMap(data, candidate.mapAt);
  } catch {
    // 坏 JSON / TOML：跳过该文件
    return null;
  }
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

function dedupeKey(config: McpServerConfig): string {
  return `${config.name}|${config.transport}|${
    config.transport === "stdio"
      ? [config.command, ...(config.args ?? [])].join(" ")
      : config.url ?? ""
  }`;
}

export async function scanMcpSources(
  workspaceRoot?: string,
  existing: McpServerConfig[] = [],
  ctx: ScanContext = defaultScanContext(),
): Promise<McpDiscoveredServer[]> {
  const results: McpDiscoveredServer[] = [];
  // 跨来源去重：同一名字 + 同一端点的定义只保留第一次出现
  const seenKeys = new Set<string>();

  for (const candidate of buildCandidates(ctx, workspaceRoot)) {
    const map = await readServerMap(candidate);
    if (!map) {
      continue;
    }
    for (const [name, entry] of toEntryList(map)) {
      const config = toConfig(
        makeId(name, candidate.path),
        name,
        entry,
        { home: ctx.home, env: ctx.env },
      );
      if (!config) {
        continue;
      }
      const key = dedupeKey(config);
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      const alreadyImported = existing.some(
        (item) => item.name === name || sameEndpoint(item, config),
      );
      results.push({
        config,
        source: candidate.source,
        sourcePath: candidate.path,
        alreadyImported,
      });
    }
  }
  return results;
}
