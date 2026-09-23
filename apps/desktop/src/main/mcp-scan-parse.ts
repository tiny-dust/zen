import type { McpServerConfig, McpTransport } from "@zen/shared";

/**
 * 各工具 MCP 配置的容错解析：JSON / JSONC / TOML 子集，
 * 以及五花八门的 server 条目形状（stdio command/args/env、http/sse url/headers）
 * 统一收拢为 McpServerConfig。坏文件 / 坏条目跳过不抛。
 */

export type RawEntry = Record<string, unknown>;
export type RawMap = Record<string, unknown>;

export function isRecord(value: unknown): value is RawEntry {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (text !== undefined) {
      out.push(text);
    }
  }
  return out;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const text = asString(item);
    if (text !== undefined) {
      out[key] = text;
    }
  }
  return out;
}

/** JSONC：去 // 与 /* *\/ 注释与尾逗号后按 JSON 解析；失败由调用方跳过 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text)) as unknown;
}

function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i] as string;
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return stripTrailingCommas(out);
}

function stripTrailingCommas(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) {
        j += 1;
      }
      const next = text[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * TOML 子集：表头 [a.b.c]、key = 值（字符串 / 数字 / 布尔 / 数组 / 内联表），
 * 够解析 Codex 的 config.toml（[mcp_servers.*] 与 [mcp_servers.*.env]）；不支持的语法整段跳过。
 */
export function parseToml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;
  for (const statement of splitTomlStatements(text)) {
    const trimmed = statement.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("[[")) {
      continue;
    }
    if (trimmed.startsWith("[")) {
      const end = trimmed.indexOf("]");
      if (end > 0) {
        current = ensureTable(root, parseKeyPath(trimmed.slice(1, end)));
      }
      continue;
    }
    const eq = findTomlAssign(trimmed);
    if (eq < 0) {
      continue;
    }
    const path = parseKeyPath(trimmed.slice(0, eq).trim());
    const last = path[path.length - 1];
    if (!last) {
      continue;
    }
    const table = ensureTable(current, path.slice(0, -1));
    const value = parseTomlValue(trimmed.slice(eq + 1).trim());
    if (value !== undefined) {
      table[last] = value;
    }
  }
  return root;
}

function splitTomlStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let quote: string | null = null;
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (quote) {
      buf += ch;
      if (ch === "\\") {
        buf += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
    }
    if (ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === "\n" && depth === 0) {
      statements.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) {
    statements.push(buf);
  }
  return statements;
}

function findTomlAssign(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "=") {
      return i;
    }
  }
  return -1;
}

function parseKeyPath(text: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === "\\") {
        buf += text[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ".") {
      if (buf.trim()) {
        parts.push(buf.trim());
      }
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) {
    parts.push(buf.trim());
  }
  return parts;
}

function ensureTable(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let node = root;
  for (const key of path) {
    const next = node[key];
    if (!isRecord(next)) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else {
      node = next;
    }
  }
  return node;
}

function parseTomlValue(text: string): unknown {
  if (!text) {
    return undefined;
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return parseTomlString(text);
  }
  if (text.startsWith("[")) {
    return parseTomlArray(text);
  }
  if (text.startsWith("{")) {
    return parseTomlInlineTable(text);
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return undefined;
}

function parseTomlString(text: string): string | undefined {
  const quote = text[0];
  if (text.length < 2 || text[text.length - 1] !== quote) {
    return undefined;
  }
  const body = text.slice(1, -1);
  if (quote === "'") {
    return body;
  }
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, esc: string) => {
    if (esc.startsWith("u")) {
      return String.fromCharCode(parseInt(esc.slice(1), 16));
    }
    const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
    return map[esc] ?? esc;
  });
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote) {
      buf += ch;
      if (ch === "\\") {
        buf += text[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
    }
    if (ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) {
    parts.push(buf);
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseTomlArray(text: string): unknown[] | undefined {
  if (!text.endsWith("]")) {
    return undefined;
  }
  const inner = text.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  const out: unknown[] = [];
  for (const part of splitTopLevel(inner)) {
    const value = parseTomlValue(part);
    if (value !== undefined) {
      out.push(value);
    }
  }
  return out;
}

function parseTomlInlineTable(text: string): Record<string, unknown> | undefined {
  if (!text.endsWith("}")) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const part of splitTopLevel(text.slice(1, -1))) {
    const eq = findTomlAssign(part);
    if (eq < 0) {
      continue;
    }
    const path = parseKeyPath(part.slice(0, eq).trim());
    const last = path[path.length - 1];
    const value = parseTomlValue(part.slice(eq + 1).trim());
    if (last && value !== undefined) {
      out[last] = value;
    }
  }
  return out;
}

/** 定位 server map：显式路径优先，否则 mcpServers / servers / mcp 键，再退顶层 map */
export function extractServerMap(data: unknown, mapAt?: string[]): RawMap {
  let node: unknown = data;
  if (mapAt?.length) {
    for (const key of mapAt) {
      if (!isRecord(node)) {
        return {};
      }
      node = node[key];
    }
    return isRecord(node) ? node : {};
  }
  if (!isRecord(data)) {
    return {};
  }
  for (const key of ["mcpServers", "servers", "mcp"]) {
    const value = data[key];
    if (isRecord(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return arrayToMap(value);
    }
  }
  return data;
}

/** DimAgent 等还可能出现 [{ name, type, url, ... }] 数组形态 */
function arrayToMap(items: unknown[]): RawMap {
  const out: RawMap = {};
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const name = asString(item.name);
    if (name) {
      out[name] = item;
    }
  }
  return out;
}

/** map 值容错成条目列表（跳过标量/数组垃圾项） */
export function toEntryList(map: RawMap): Array<[string, RawEntry]> {
  const out: Array<[string, RawEntry]> = [];
  for (const [name, entry] of Object.entries(map)) {
    if (isRecord(entry)) {
      out.push([name, entry]);
    }
  }
  return out;
}

export interface ExpandContext {
  home: string;
  env: Record<string, string | undefined>;
}

/**
 * 展开 `~` 开头路径与 ${VAR} 环境变量引用（未定义的 VAR 保持原样）。
 * 配置文件里常见 ~/bin/srv、${HOME}/x；spawn 不走 shell，导入前必须先展开。
 */
export function expandValue(text: string, ctx: ExpandContext): string {
  let out = text;
  if (out === "~" || out.startsWith("~/")) {
    out = ctx.home + out.slice(1);
  }
  return out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => ctx.env[name] ?? match);
}

function detectTransport(entry: RawEntry, type: string | undefined, hasCommand: boolean, url: string | undefined): McpTransport | null {
  if (hasCommand) {
    return "stdio";
  }
  if (!url) {
    return null;
  }
  if (type === "sse" || entry.sseUrl !== undefined) {
    return "sse";
  }
  if (type === "http" || type === "streamable-http" || type === "streamable_http") {
    return "http";
  }
  // 未标注类型时按 URL 形态猜（/sse 结尾 → SSE 旧版，其余 → HTTP 新版）
  return /\/sse\/?($|\?)/i.test(url) ? "sse" : "http";
}

/**
 * 条目归一：兼容
 * - Claude/Cursor/Windsurf/Gemini/VS Code/DimAgent：{ command, args, env } 或 { type, url, headers }
 * - Gemini：{ httpUrl | sseUrl, headers }
 * - MiMo（mimocode）：{ type: "local"|"remote", command: string[], environment }
 * - Codex TOML：{ command, args, env, url, http_headers, bearer_token_env_var, enabled }
 * - DimAgent 数组形态：{ type: "url", name, url, authorizationToken }
 */
export function toConfig(
  id: string,
  name: string,
  entry: RawEntry,
  expand?: ExpandContext,
): McpServerConfig | null {
  const type = asString(entry.type)?.toLowerCase();
  let command = asString(entry.command);
  let args = asStringArray(entry.args);
  const commandList = Array.isArray(entry.command) ? asStringArray(entry.command) : [];
  if (!command && commandList.length) {
    command = commandList[0];
    args = [...commandList.slice(1), ...args];
  }
  if (!command && type === "local") {
    return null;
  }
  const rawUrl = asString(entry.url) ?? asString(entry.httpUrl) ?? asString(entry.sseUrl);
  const url = expand && rawUrl ? expandValue(rawUrl, expand) : rawUrl;
  const transport = detectTransport(entry, type, !!command, url);
  if (!transport) {
    return null;
  }
  const rawEnv = asStringMap(entry.env) ?? asStringMap(entry.environment);
  const rawHeaders: Record<string, string> = {
    ...(asStringMap(entry.headers) ?? asStringMap(entry.http_headers) ?? {}),
  };
  const token = asString(entry.authorizationToken);
  if (token) {
    rawHeaders["Authorization"] = `Bearer ${token}`;
  }
  const ex = (text: string) => (expand ? expandValue(text, expand) : text);
  const env = rawEnv
    ? Object.fromEntries(Object.entries(rawEnv).map(([key, value]) => [key, ex(value)]))
    : undefined;
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([key, value]) => [key, ex(value)]),
  );
  const enabled = entry.enabled !== false;

  if (transport === "stdio") {
    return {
      id,
      name,
      transport,
      command: command ? ex(command) : (command as string),
      args: args.map(ex),
      ...(Object.keys(env ?? {}).length ? { env } : {}),
      enabled,
    };
  }
  if (!url) {
    return null;
  }
  return {
    id,
    name,
    transport,
    url,
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled,
  };
}
