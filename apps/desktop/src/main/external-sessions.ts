import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

import { EXTERNAL_AGENT_CLIENTS } from "@zen/shared";
import type {
  ExternalAgentClient,
  ExternalClientCapability,
  ExternalResumeBlocked,
  ExternalScanGroup,
  ExternalSessionSummary,
  ExternalSessionTrace,
  ExternalSessionsResult,
  ExternalTraceEvent,
  ExternalTraceKind,
} from "@zen/shared";

/**
 * 外部 agent 会话（只读读取层）。
 *
 * 只做三件事：定位各客户端自己的会话目录、解析会话元信息、按需解析运行轨迹。
 * 不写回、不导入 Zen 数据库、不控制对方进程；读不到的字段留空，绝不猜。
 *
 * 目录口径对照 nomi 2.5.3（apps/desktop-go/internal/core/agents/service.go）：
 * claude ~/.claude/projects/ 下递归 jsonl、codex ~/.codex/sessions/ 下递归 jsonl、
 * gemini ~/.gemini/tmp 下 chats 目录里的 session-*.json(l)、dsh $DSH_HOME/sessions/<id>/session.v*.jsonl、
 * grok $GROK_HOME/sessions/<cwd>/<id>/updates.jsonl。
 */

/** 单个客户端最多扫多少个会话文件（按修改时间取最新） */
const MAX_FILES_PER_CLIENT = 80;
/** 单个会话文件最多读多少字节（超出只读首尾，避免把大文件整块塞进内存） */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 轨迹最多保留多少条事件 */
const MAX_EVENTS = 300;
/** 单条事件文本上限 */
const MAX_EVENT_TEXT = 4000;
/** 列表里只统计条数，不返回正文 */
const SUMMARY_SCAN_BYTES = 512 * 1024;

export interface ExternalClientRoots {
  claude: string;
  codex: string;
  gemini: string;
  dsh: string;
  grok: string;
}

/**
 * 各平台会话根目录：
 * - win32 用 %USERPROFILE%（home 已由 os.homedir 给出，等价），环境变量优先；
 * - POSIX 用 $HOME；DSH/GROK 支持自己的 *_HOME 覆盖。
 */
export function resolveClientRoots(
  home: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): ExternalClientRoots {
  const base = platform === "win32" ? env["USERPROFILE"] || home : home;
  return {
    claude: join(base, ".claude", "projects"),
    codex: join(base, ".codex", "sessions"),
    gemini: join(base, ".gemini", "tmp"),
    dsh: join(env["DSH_HOME"] || join(base, ".dsh"), "sessions"),
    grok: join(env["GROK_HOME"] || join(base, ".grok"), "sessions"),
  };
}

interface CandidateFile {
  client: ExternalAgentClient;
  path: string;
  mtime: number;
}

async function safeStat(path: string): Promise<{ mtime: number; size: number; isDir: boolean } | null> {
  try {
    const info = await stat(path);
    return { mtime: info.mtimeMs, size: info.size, isDir: info.isDirectory() };
  } catch {
    return null;
  }
}

/** 递归收集会话文件（深度受限，命中上限即停；目录不存在即视为未安装） */
async function collectFiles(
  root: string,
  depth: number,
  match: (name: string, fullPath: string) => boolean,
  client: ExternalAgentClient,
  out: CandidateFile[],
): Promise<boolean> {
  const rootInfo = await safeStat(root);
  if (!rootInfo?.isDir) {
    return false;
  }
  let added = 0;
  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > depth || added >= MAX_FILES_PER_CLIENT * 4) {
      return;
    }
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const info = await safeStat(full);
      if (!info) {
        continue;
      }
      if (info.isDir) {
        await walk(full, level + 1);
        continue;
      }
      if (match(name, full)) {
        out.push({ client, path: full, mtime: info.mtime });
        added += 1;
      }
    }
  };
  await walk(root, 1);
  return true;
}

export async function listCandidateFiles(
  roots: ExternalClientRoots,
  limitPerClient = MAX_FILES_PER_CLIENT,
): Promise<{ files: CandidateFile[]; detected: Record<ExternalAgentClient, boolean> }> {
  const found: CandidateFile[] = [];
  const detected: Record<ExternalAgentClient, boolean> = {
    claude: false,
    codex: false,
    gemini: false,
    dsh: false,
    grok: false,
  };
  const jsonl = (name: string) => name.endsWith(".jsonl");
  const plans: Array<[ExternalAgentClient, string, number, (n: string, p: string) => boolean]> = [
    ["claude", roots.claude, 2, jsonl],
    ["codex", roots.codex, 4, jsonl],
    ["gemini", roots.gemini, 3, (n, p) => /^session-[^\n\r]*\.jsonl?$/.test(n) && p.includes(`${sep}chats${sep}`)],
    ["dsh", roots.dsh, 2, (n) => /^session\.v\d+\.jsonl$/.test(n)],
    ["grok", roots.grok, 3, (n) => n === "updates.jsonl"],
  ];
  for (const [client, root, depth, match] of plans) {
    const before = found.length;
    detected[client] = await collectFiles(root, depth, match, client, found);
    const mine = found.slice(before).sort((a, b) => b.mtime - a.mtime).slice(0, limitPerClient);
    found.length = before;
    found.push(...mine);
  }
  return { files: found, detected };
}

// ---------------------------------------------------------------------------
// 解析工具（纯函数，供单测直接用真实样本喂）
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clip(text: string, max = MAX_EVENT_TEXT): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** JSONL 逐行解析：坏行静默跳过（客户端可能在写入中被打断） */
export function parseJsonl(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = asRecord(JSON.parse(trimmed));
      if (parsed) {
        out.push(parsed);
      }
    } catch {
      // 正在写入或损坏的行：跳过，不影响其余事件
    }
  }
  return out;
}

/** 从内容块数组/字符串里取文本 */
function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) {
      continue;
    }
    const type = str(record["type"]);
    if (type === "text" || type === "input_text" || type === "output_text") {
      parts.push(str(record["text"]));
    }
  }
  return parts.join("\n");
}

export interface ParsedSession {
  sessionId: string;
  title: string;
  cwd?: string;
  events: ExternalTraceEvent[];
}

function pushEvent(list: ExternalTraceEvent[], event: ExternalTraceEvent): void {
  if (list.length >= MAX_EVENTS) {
    return;
  }
  if (!event.text.trim()) {
    return;
  }
  list.push({ ...event, text: clip(event.text) });
}

/** Claude Code：type user/assistant/summary/custom-title，message.content 里混 text/thinking/tool_use/tool_result */
export function parseClaudeSession(text: string): ParsedSession {
  const lines = parseJsonl(text);
  const events: ExternalTraceEvent[] = [];
  let sessionId = "";
  let cwd = "";
  let nativeTitle = "";
  let firstUser = "";
  for (const line of lines) {
    const type = str(line["type"]);
    sessionId ||= str(line["sessionId"]);
    cwd ||= str(line["cwd"]);
    if (type === "custom-title") {
      nativeTitle ||= str(line["customTitle"]) || str(line["title"]);
    }
    if (type === "summary") {
      nativeTitle ||= str(line["summary"]);
    }
    const message = asRecord(line["message"]);
    const time = num(line["timestamp"]);
    if (type === "user" && message) {
      const blocks = message["content"];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          const record = asRecord(block);
          if (!record) {
            continue;
          }
          if (str(record["type"]) === "tool_result") {
            pushEvent(events, {
              kind: record["is_error"] === true ? "error" : "result",
              text: contentText(record["content"]) || `工具结果（${str(record["tool_use_id"]).slice(0, 8)}）`,
              time,
              sourceType: "tool_result",
              isError: record["is_error"] === true,
            });
          }
        }
      }
      const textContent = contentText(blocks);
      if (textContent) {
        firstUser ||= textContent;
        pushEvent(events, { kind: "user", text: textContent, time, sourceType: type });
      }
      continue;
    }
    if (type === "assistant" && message) {
      const blocks = message["content"];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          const record = asRecord(block);
          if (!record) {
            continue;
          }
          const blockType = str(record["type"]);
          if (blockType === "thinking") {
            pushEvent(events, { kind: "thinking", text: str(record["thinking"]) || str(record["text"]), time, sourceType: blockType });
          } else if (blockType === "tool_use") {
            pushEvent(events, {
              kind: "tool",
              text: str(record["name"]) || "tool",
              toolName: str(record["name"]),
              time,
              sourceType: blockType,
            });
          }
        }
      }
      const textContent = contentText(blocks);
      if (textContent) {
        pushEvent(events, { kind: "assistant", text: textContent, time, sourceType: type });
      }
      continue;
    }
    if (type === "result") {
      pushEvent(events, {
        kind: line["is_error"] === true ? "error" : "result",
        text: str(line["result"]) || str(line["subtype"]) || "（会话结束）",
        time,
        sourceType: type,
        isError: line["is_error"] === true,
      });
    }
  }
  return {
    sessionId,
    cwd: cwd || undefined,
    title: clip(nativeTitle || firstUser, 80),
    events,
  };
}

/** Codex：session_meta / response_item / event_msg 三种主类型 */
export function parseCodexSession(text: string): ParsedSession {
  const lines = parseJsonl(text);
  const events: ExternalTraceEvent[] = [];
  let sessionId = "";
  let cwd = "";
  let firstUser = "";
  for (const line of lines) {
    const type = str(line["type"]);
    const payload = asRecord(line["payload"]) ?? {};
    const payloadType = str(payload["type"]);
    const time = num(line["timestamp"]);
    if (type === "session_meta") {
      sessionId ||= str(payload["id"]);
      cwd ||= str(payload["cwd"]);
      continue;
    }
    if (type === "turn_context") {
      cwd ||= str(payload["cwd"]);
      continue;
    }
    if (type === "event_msg") {
      if (payloadType === "user_message") {
        const message = str(payload["message"]);
        firstUser ||= message;
        pushEvent(events, { kind: "user", text: message, time, sourceType: payloadType });
      } else if (payloadType === "agent_message") {
        pushEvent(events, { kind: "assistant", text: str(payload["message"]), time, sourceType: payloadType });
      } else if (payloadType === "agent_reasoning") {
        pushEvent(events, { kind: "thinking", text: str(payload["text"]), time, sourceType: payloadType });
      } else if (payloadType === "task_complete") {
        pushEvent(events, { kind: "result", text: str(payload["last_agent_message"]) || "（一轮结束）", time, sourceType: payloadType });
      } else if (payloadType === "error" || payloadType === "stream_error") {
        pushEvent(events, {
          kind: "error",
          text: str(payload["message"]) || payloadType,
          time,
          sourceType: payloadType,
          isError: true,
        });
      } else if (payloadType.startsWith("exec_command_") || payloadType.startsWith("patch_apply_") || payloadType.startsWith("mcp_tool_call_")) {
        pushEvent(events, { kind: "tool", text: payloadType, time, sourceType: payloadType });
      }
      continue;
    }
    if (type === "response_item") {
      if (payloadType === "message") {
        const role = str(payload["role"]);
        const textContent = contentText(payload["content"]);
        if (role === "user") {
          firstUser ||= textContent;
          pushEvent(events, { kind: "user", text: textContent, time, sourceType: "message" });
        } else {
          pushEvent(events, { kind: "assistant", text: textContent, time, sourceType: "message" });
        }
      } else if (payloadType === "function_call" || payloadType === "local_shell_call" || payloadType === "custom_tool_call") {
        pushEvent(events, {
          kind: "tool",
          text: str(payload["name"]) || payloadType,
          toolName: str(payload["name"]),
          time,
          sourceType: payloadType,
        });
      } else if (payloadType === "function_call_output" || payloadType === "local_shell_call_output") {
        pushEvent(events, { kind: "result", text: contentText(payload["output"]) || payloadType, time, sourceType: payloadType });
      } else if (payloadType === "reasoning") {
        pushEvent(events, { kind: "thinking", text: contentText(payload["summary"]) || contentText(payload["content"]), time, sourceType: payloadType });
      }
      continue;
    }
    if (type === "turn.completed") {
      pushEvent(events, { kind: "result", text: str(line["message"]) || "（一轮结束）", time, sourceType: type });
    } else if (type === "turn.failed" || type === "error") {
      pushEvent(events, {
        kind: "error",
        text: str(line["message"]) || str(asRecord(line["error"])?.["message"]) || type,
        time,
        sourceType: type,
        isError: true,
      });
    }
  }
  return { sessionId, cwd: cwd || undefined, title: clip(firstUser, 80), events };
}

/** Gemini CLI：整份 JSON，messages[].type = user / gemini，toolCalls 内联 */
export function parseGeminiSession(text: string): ParsedSession {
  const events: ExternalTraceEvent[] = [];
  let sessionId = "";
  let cwd = "";
  let nativeTitle = "";
  let firstUser = "";
  let root: Record<string, unknown> | null = null;
  try {
    root = asRecord(JSON.parse(text));
  } catch {
    root = null;
  }
  if (root) {
    sessionId = str(root["sessionId"]);
    cwd = str(root["cwd"]) || str(asRecord(root["metadata"])?.["cwd"]);
    nativeTitle = str(asRecord(root["summary"])?.["title"]) || str(root["summary"]);
    const messages = Array.isArray(root["messages"]) ? root["messages"] : [];
    for (const item of messages) {
      const message = asRecord(item);
      if (!message) {
        continue;
      }
      const type = str(message["type"]);
      const time = num(message["timestamp"]);
      const body = contentText(message["content"]);
      if (type === "user") {
        if (body.startsWith("<session_context>")) {
          continue;
        }
        firstUser ||= body;
        pushEvent(events, { kind: "user", text: body, time, sourceType: type });
      } else if (type === "gemini" || type === "model") {
        if (body) {
          pushEvent(events, { kind: "assistant", text: body, time, sourceType: type });
        }
        const calls = Array.isArray(message["toolCalls"]) ? message["toolCalls"] : [];
        for (const call of calls) {
          const record = asRecord(call);
          if (!record) {
            continue;
          }
          pushEvent(events, {
            kind: "tool",
            text: str(record["name"]) || "tool",
            toolName: str(record["name"]),
            time,
            sourceType: "toolCall",
          });
          if (record["result"] != null) {
            pushEvent(events, { kind: "result", text: String(record["result"]), time, sourceType: "toolResult" });
          }
        }
      } else if (type === "error") {
        pushEvent(events, { kind: "error", text: body || "error", time, sourceType: type, isError: true });
      }
    }
  }
  return { sessionId, cwd: cwd || undefined, title: clip(nativeTitle || firstUser, 80), events };
}

/** DSH：type user/message、assistant/message、tool/*、turn/end，正文在 data.content */
export function parseDshSession(text: string): ParsedSession {
  const events: ExternalTraceEvent[] = [];
  let sessionId = "";
  let cwd = "";
  let nativeTitle = "";
  let firstUser = "";
  for (const line of parseJsonl(text)) {
    const type = str(line["type"]);
    const data = asRecord(line["data"]) ?? {};
    sessionId ||= str(line["id"]) || str(line["sessionId"]);
    cwd ||= str(data["cwd"]);
    const time = num(line["time"]) ?? num(line["timestamp"]);
    if (type === "session/title") {
      nativeTitle ||= str(data["title"]);
      continue;
    }
    if (type === "user/message") {
      const body = contentText(data["content"]) || str(data["content"]);
      firstUser ||= body;
      pushEvent(events, { kind: "user", text: body, time, sourceType: type });
      continue;
    }
    if (type === "assistant/message") {
      pushEvent(events, { kind: "assistant", text: contentText(data["content"]) || str(data["content"]), time, sourceType: type });
      continue;
    }
    if (type.startsWith("tool/")) {
      pushEvent(events, { kind: "tool", text: str(data["name"]) || type, toolName: str(data["name"]), time, sourceType: type });
      continue;
    }
    if (type === "turn/end") {
      pushEvent(events, { kind: "result", text: str(data["reason"]) || "（一轮结束）", time, sourceType: type });
      continue;
    }
    if (type === "error") {
      pushEvent(events, { kind: "error", text: str(data["message"]) || "error", time, sourceType: type, isError: true });
    }
  }
  return { sessionId, cwd: cwd || undefined, title: clip(nativeTitle || firstUser, 80), events };
}

/** Grok：updates.jsonl，主类型 params.update.sessionUpdate */
export function parseGrokSession(text: string): ParsedSession {
  const events: ExternalTraceEvent[] = [];
  let sessionId = "";
  let cwd = "";
  let nativeTitle = "";
  let firstUser = "";
  for (const line of parseJsonl(text)) {
    const params = asRecord(line["params"]) ?? line;
    const update = asRecord(params["update"]) ?? params;
    sessionId ||= str(line["sessionId"]) || str(params["sessionId"]) || str(update["sessionId"]);
    cwd ||= str(line["cwd"]) || str(params["cwd"]) || str(update["cwd"]);
    const time = num(line["timestamp"]) ?? num(line["time"]) ?? num(update["timestamp"]);
    const kind = str(update["sessionUpdate"]);
    if (kind === "session_info_update") {
      nativeTitle ||= str(update["title"]);
      continue;
    }
    const body = contentText(update["content"]) || str(update["content"]) || str(update["text"]);
    if (kind === "user_message_chunk") {
      firstUser ||= body;
      pushEvent(events, { kind: "user", text: body, time, sourceType: kind });
    } else if (kind === "agent_message_chunk") {
      pushEvent(events, { kind: "assistant", text: body, time, sourceType: kind });
    } else if (kind === "agent_thought_chunk") {
      pushEvent(events, { kind: "thinking", text: body, time, sourceType: kind });
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      pushEvent(events, {
        kind: "tool",
        text: str(update["title"]) || str(update["toolName"]) || kind,
        toolName: str(update["toolName"]) || str(update["title"]),
        time,
        sourceType: kind,
      });
    } else if (kind === "turn_completed") {
      pushEvent(events, { kind: "result", text: "（一轮结束）", time, sourceType: kind });
    }
  }
  return { sessionId, cwd: cwd || undefined, title: clip(nativeTitle || firstUser, 80), events };
}

const PARSERS: Record<ExternalAgentClient, (text: string) => ParsedSession> = {
  claude: parseClaudeSession,
  codex: parseCodexSession,
  gemini: parseGeminiSession,
  dsh: parseDshSession,
  grok: parseGrokSession,
};

/**
 * 读文件：只读前 maxBytes 字节。
 * 用文件句柄按需读入，而不是先整份读进内存再截字符串——会话文件可能有几百 MB，
 * 那样等于没有上限。截断时退回最后一个换行，避免把 JSONL 的末行读成半截。
 */
export async function readBounded(path: string, maxBytes = MAX_FILE_BYTES): Promise<{ text: string; truncated: boolean }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, "r");
    const info = await handle.stat();
    const size = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    const truncated = info.size > bytesRead;
    if (truncated) {
      const lastNewline = text.lastIndexOf("\n");
      if (lastNewline > 0) {
        text = text.slice(0, lastNewline);
      }
    }
    return { text, truncated };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 会话 ID 兜底：文件名（去扩展）、父目录名 */
function fallbackSessionId(client: ExternalAgentClient, path: string): string {
  if (client === "dsh" || client === "grok") {
    return basename(dirname(path));
  }
  return basename(path).replace(/\.jsonl?$/, "");
}

/** 锁超过这个时长没更新，就当成上一个会话留下的残留（DSH 每轮都会刷新它） */
const DSH_LOCK_FRESH_MS = 90_000;

async function dshStatus(path: string): Promise<"running" | "idle" | "unverified"> {
  // 只有「锁存在且刚被刷新」才算可信的运行中；
  // 锁残留或没有锁都只说明我们没看到活跃写入，不能断言已结束，也不宣称在跑。
  const lock = await safeStat(join(dirname(path), "session.lock"));
  if (lock && Date.now() - lock.mtime <= DSH_LOCK_FRESH_MS) {
    return "running";
  }
  return "unverified";
}

export async function scanExternalSessions(): Promise<ExternalSessionsResult> {
  const roots = resolveClientRoots(homedir(), process.env);
  const { files, detected } = await listCandidateFiles(roots);
  const sessions: ExternalSessionSummary[] = [];
  let skipped = 0;
  for (const file of files) {
    try {
      const { text } = await readBounded(file.path, SUMMARY_SCAN_BYTES);
      const parsed = PARSERS[file.client](text);
      const sessionId = parsed.sessionId || fallbackSessionId(file.client, file.path);
      const cwd = parsed.cwd;
      const fallbackTitle = cwd ? basename(cwd) : basename(file.path);
      sessions.push({
        id: `${file.client}:${sessionId}`,
        client: file.client,
        sessionId,
        title: parsed.title || fallbackTitle,
        ...(cwd ? { cwd } : {}),
        updatedAt: file.mtime,
        status: file.client === "dsh" ? await dshStatus(file.path) : "unverified",
        eventCount: parsed.events.length,
        path: file.path,
      });
    } catch {
      skipped += 1;
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: ExternalScanGroup[] = EXTERNAL_AGENT_CLIENTS.map((client) => ({
    client,
    detected: detected[client],
    count: sessions.filter((session) => session.client === client).length,
  }));
  return { sessions, groups, skipped };
}

/** 按会话 id 读轨迹：id 里带客户端前缀，找不到或解析不出就返回空列表（不编内容） */
export async function readExternalTrace(id: string): Promise<ExternalSessionTrace> {
  const [client = "", ...rest] = id.split(":");
  const sessionId = rest.join(":");
  const empty: ExternalSessionTrace = { id, events: [], truncated: false };
  if (!(EXTERNAL_AGENT_CLIENTS as readonly string[]).includes(client) || !sessionId) {
    return empty;
  }
  const scan = await scanExternalSessions();
  const summary = scan.sessions.find((item) => item.id === id);
  if (!summary) {
    return empty;
  }
  try {
    const { text, truncated } = await readBounded(summary.path);
    const parsed = PARSERS[client as ExternalAgentClient](text);
    return { id, events: parsed.events, truncated };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 轨迹事件按种类分桶计数（界面显示「n 条工具 / n 条思考」用） */
export function countTraceKinds(events: ExternalTraceEvent[]): Record<ExternalTraceKind, number> {
  const counts: Record<ExternalTraceKind, number> = {
    user: 0,
    assistant: 0,
    thinking: 0,
    tool: 0,
    result: 0,
    error: 0,
    unknown: 0,
  };
  for (const event of events) {
    counts[event.kind] += 1;
  }
  return counts;
}

/** 相对路径辅助（测试与日志用） */
export function relativeTo(root: string, path: string): string {
  return relative(root, path);
}

// ---------------------------------------------------------------------------
// 续聊辅助：只在本地扫描结果上做判断，不接受渲染层给的 client / sessionId / path
// ---------------------------------------------------------------------------

/** 会话 ID 允许的字符集：既挡住路径与 shell 元字符，也覆盖各厂商的实际格式 */
const RESUMABLE_SESSION_ID = /^[A-Za-z0-9._:-]{1,160}$/;

export function isResumableSessionId(value: string): boolean {
  return RESUMABLE_SESSION_ID.test(value);
}

/** 列表项 + 续聊可用性：shared 里的摘要类型不含这两个字段，界面可自行取用 */
export interface ExternalSessionListItem extends ExternalSessionSummary {
  resumable: boolean;
  /** resumable=false 时被拦下的原因（与 send 返回的 blocked 一致） */
  resumeBlocked?: ExternalResumeBlocked;
}

/**
 * 把能力探测结果贴到会话列表上：解析层不自己起子进程，调用方传入 capabilities。
 * 会话 ID 不合法时一律不可续聊，避免界面给出会失败的按钮。
 */
export function attachResumability(
  sessions: ExternalSessionSummary[],
  capabilities: ExternalClientCapability[],
): ExternalSessionListItem[] {
  const byClient = new Map(capabilities.map((capability) => [capability.client, capability]));
  return sessions.map((session) => {
    const capability = byClient.get(session.client);
    if (capability?.resume === "supported" && isResumableSessionId(session.sessionId)) {
      return { ...session, resumable: true };
    }
    const blocked: ExternalResumeBlocked =
      capability?.resume === "missing-cli"
        ? "missing-cli"
        : capability?.resume === "supported"
          ? "unknown-session"
          : "unsupported";
    return { ...session, resumable: false, resumeBlocked: blocked };
  });
}

/** 按 id 查一条本地扫描结果：续聊只用这里给出的 cwd / sessionId */
export async function findExternalSession(id: string): Promise<ExternalSessionSummary | null> {
  const scan = await scanExternalSessions();
  return scan.sessions.find((session) => session.id === id) ?? null;
}
