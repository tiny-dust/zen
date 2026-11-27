/**
 * 运行轨迹文档模型（纯函数，无 Vue 组件，便于单测）：把 Zen 的会话消息
 * （`ChatMessage.parts` 里的思考 / 工具分段 + `meta.run` 的起止与用量）
 * 归一成「泳道 → 轮次 → 节点」三层文档，供轨迹图、时间线、思考脉络、检查器共用。
 *
 * 与 Nomi 的差异：Zen 的分段不带时间戳、没有子代理 / 网关请求 / 模型指纹，
 * 因此节点时间按「已知耗时（reasoning.ms）+ 顺序虚拟游标」推算，
 * 工具调用只有位置没有跨度，剩余时间落在「生成与等待」里。
 */
import type { AgentDoneReason, AgentRunStatus } from "@zen/shared";
import type { ChatMessage, ChatMessagePart, ToolCallState } from "@zen/shared";

import { getMessageRun } from "@zen/shared";

import { toolDisplay } from "@/components/chat/tool-part";
import { i18n } from "@/locales";

import { compactPreview, thoughtTitle } from "./format";

/** 慢步骤阈值（毫秒）：超过 2s 在界面标为慢步骤 */
export const SLOW_STEP_MS = 2_000;

export type TraceNodeKind = "user" | "thinking" | "tool" | "reply" | "error";
export type TraceNodeStatus = "done" | "running" | "error" | "stopped";
/** 聚簇用的工具类别（Nomi 的 Bucket） */
export type TraceBucket = "explore" | "command" | "edit" | "other";

export interface TraceToolCall {
  id: string;
  name: string;
  state: ToolCallState;
  args?: unknown;
  output?: unknown;
  summary?: string;
  error?: string;
}

export interface TraceNode {
  id: string;
  kind: TraceNodeKind;
  laneId: string;
  turnId: string;
  depth: number;
  title: string;
  subtitle?: string;
  bucket?: TraceBucket;
  status: TraceNodeStatus;
  start?: number;
  end?: number;
  durationMs?: number;
  /** 全文检索用：所有可读字段小写拼接 */
  searchText: string;
  call?: TraceToolCall;
  text?: string;
}

export interface TraceWave {
  id: string;
  kind: "single" | "parallel";
  nodeIds: string[];
}

export interface TraceTurn {
  id: string;
  laneId: string;
  index: number;
  label: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status: TraceNodeStatus;
  usage?: { inputTokens: number; outputTokens: number };
  nodeIds: string[];
  requestNodeIds: string[];
  waves: TraceWave[];
}

export interface TraceLane {
  id: string;
  name: string;
  kind: "main";
  status: TraceNodeStatus;
  stepCount: number;
  durationMs?: number;
}

export interface TraceStats {
  turns: number;
  thinkingCount: number;
  toolCount: number;
  failedCount: number;
  slowCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TraceDocument {
  scope: "session";
  title: string;
  from: number;
  to: number;
  lanes: TraceLane[];
  lanesById: Record<string, TraceLane>;
  turns: TraceTurn[];
  turnsById: Record<string, TraceTurn>;
  nodesById: Record<string, TraceNode>;
  orderedNodeIds: string[];
  rootTurnIds: string[];
  stats: TraceStats;
}

/** Zen 工具名 → 聚簇类别（顺序与 Nomi 的 bucketOf 一致） */
const TOOL_BUCKETS: Record<string, TraceBucket> = {
  readFile: "explore",
  listDir: "explore",
  searchFiles: "explore",
  webSearch: "explore",
  webFetch: "explore",
  runTerminal: "command",
  writeFile: "edit",
  editFile: "edit",
};

export function toolBucket(toolName: string): TraceBucket {
  if (toolName.startsWith("browser")) {
    return "explore";
  }
  return TOOL_BUCKETS[toolName] ?? "other";
}

/** `mcp__server__tool` / `server.tool` → 取最后一段并小写 */
export function baseToolName(name: string): string {
  const parts = name.split(/__|\./).filter(Boolean);
  return (parts[parts.length - 1] ?? name).toLowerCase();
}

export function toolStatus(state: ToolCallState): TraceNodeStatus {
  if (state === "ok") {
    return "done";
  }
  if (state === "running" || state === "input-streaming" || state === "awaiting-approval") {
    return "running";
  }
  return "error";
}

function buildSearchText(parts: ReadonlyArray<string | undefined | null>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ")
    .toLowerCase();
}

/** 工具输出转文本：字符串原样，其余 JSON 化，超长截断 */
function outputText(output: unknown): string {
  if (output === undefined || output === null) {
    return "";
  }
  if (typeof output === "string") {
    return output;
  }
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return String(output);
  }
}

function argsText(args: unknown): string {
  if (args === undefined || args === null) {
    return "";
  }
  try {
    return JSON.stringify(args) ?? "";
  } catch {
    return "";
  }
}

/** 分段：新消息直接用 parts；只有 reasoning/content 的旧消息按顺序补出分段 */
function partsOf(message: ChatMessage): ChatMessagePart[] {
  if (message.parts?.length) {
    return message.parts;
  }
  const parts: ChatMessagePart[] = [];
  if (message.reasoning?.trim()) {
    parts.push({ type: "reasoning", text: message.reasoning, ms: message.reasoningMs, done: true });
  }
  if (message.content.trim()) {
    parts.push({ type: "text", text: message.content, done: true });
  }
  return parts;
}

function turnStatusOf(
  status: AgentRunStatus | undefined,
  reason: AgentDoneReason | undefined,
  endedAt: number | undefined,
): TraceNodeStatus {
  if (status === "error" || reason === "error") {
    return "error";
  }
  if (reason === "cancelled") {
    return "stopped";
  }
  if (status !== undefined && endedAt === undefined) {
    return "running";
  }
  return "done";
}

interface MessagePair {
  user?: ChatMessage;
  assistant?: ChatMessage;
}

/** 用户消息与紧随其后的助手消息配成一轮（system / tool 角色不进轨迹） */
function pairMessages(messages: readonly ChatMessage[]): MessagePair[] {
  const pairs: MessagePair[] = [];
  let pendingUser: ChatMessage | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      if (pendingUser) {
        pairs.push({ user: pendingUser });
      }
      pendingUser = message;
      continue;
    }
    if (message.role === "assistant") {
      pairs.push(pendingUser ? { user: pendingUser, assistant: message } : { assistant: message });
      pendingUser = undefined;
    }
  }
  if (pendingUser) {
    pairs.push({ user: pendingUser });
  }
  return pairs;
}

/** 每个节点单独一「波」：Zen 的分段是有序数组，没有时间戳可判断并行扇出 */
function buildWaves(nodes: readonly TraceNode[], turnId: string): TraceWave[] {
  return nodes.map((node, index) => ({
    id: `w-${turnId}-${index}`,
    kind: "single" as const,
    nodeIds: [node.id],
  }));
}

/**
 * 一轮的构建结果。消息对象在流式期间是原地变更的，所以缓存键用对象本身，
 * 再用一个便宜的签名判断有没有变：只有正在生成的那一轮需要重建。
 */
interface TurnFragment {
  sig: string;
  nodes: TraceNode[];
  startedAt: number;
  endedAt?: number;
  status: TraceNodeStatus;
  usage?: { inputTokens: number; outputTokens: number };
}

const fragmentCache = new WeakMap<object, TurnFragment>();

/** 签名只看会进轨迹的字段；工具输出在 tool_end 时随 state 一起变，不会漏 */
function signatureOf(message: ChatMessage | undefined): string {
  if (!message) {
    return "-";
  }
  const run = getMessageRun(message);
  let sig = `${message.content.length}:${message.reasoning?.length ?? 0}:${message.reasoningMs ?? 0}'`;
  for (const part of message.parts ?? []) {
    if (part.type === "reasoning") {
      sig += `r${part.text.length}:${part.ms ?? 0}:${part.done === false ? 0 : 1}`;
    } else if (part.type === "tool") {
      sig += `t${part.state}:${part.error?.length ?? 0}:${part.summary?.length ?? 0}:${
        typeof part.percent === "number" ? part.percent : ""
      }:${part.message?.length ?? 0}`;
    } else {
      sig += "x";
    }
  }
  sig += `|${run?.status ?? ""}:${run?.endedAt ?? 0}:${run?.error?.length ?? 0}:${
    run?.usage?.inputTokens ?? 0
  }:${run?.usage?.outputTokens ?? 0}`;
  return sig;
}

function buildTurnFragment(pair: MessagePair): TurnFragment {
  const { t } = i18n.global;
  const assistant = pair.assistant;
  const run = assistant ? getMessageRun(assistant) : undefined;
  // 稳定 id：按消息与分段序号生成，流式追加新节点时旧节点的 id 不变（选中项不会漂移）
  const owner = assistant?.id ?? pair.user?.id ?? "none";
  const turnId = `turn:${owner}`;
  const turnStart = run?.startedAt ?? assistant?.createdAt ?? pair.user?.createdAt ?? 0;
  const turnEnd = run?.endedAt;
  const status = turnStatusOf(run?.status, run?.reason, run?.endedAt);
  const nodes: TraceNode[] = [];

  if (pair.user && pair.user.content.trim()) {
    const text = pair.user.content;
    nodes.push({
      id: `nu:${pair.user.id}`,
      kind: "user",
      laneId: "main",
      turnId,
      depth: 0,
      title: t("trace.userInput"),
      subtitle: compactPreview(text, 72),
      status: "done",
      start: pair.user.createdAt,
      end: pair.user.createdAt,
      text,
      searchText: buildSearchText([t("trace.userInput"), text]),
    });
  }

  // 思考与工具按分段顺序排：思考用真实耗时推进游标，工具只占位置
  let cursor = turnStart;
  const parts = assistant ? partsOf(assistant) : [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part.type === "reasoning") {
      if (!part.text.trim()) {
        continue;
      }
      const ms = part.ms !== undefined && part.ms >= 0 ? part.ms : undefined;
      const start = cursor;
      const end = ms !== undefined ? start + ms : start;
      if (ms !== undefined) {
        cursor = end;
      }
      const summary = thoughtTitle(part.text) || t("trace.thinkingProcess");
      nodes.push({
        id: `nt:${owner}:${index}`,
        kind: "thinking",
        laneId: "main",
        turnId,
        depth: 0,
        title: summary,
        subtitle: t("trace.thinkingProcess"),
        status: part.done === false ? "running" : "done",
        start,
        end,
        durationMs: ms,
        text: part.text,
        searchText: buildSearchText([t("trace.thinkingProcess"), summary, part.text]),
      });
      continue;
    }

    if (part.type === "tool") {
      const display = toolDisplay(part.toolName, part.args);
      const target = display.target?.text;
      nodes.push({
        id: `nx:${owner}:${index}`,
        kind: "tool",
        laneId: "main",
        turnId,
        depth: 0,
        title: target ? `${display.label} · ${compactPreview(target, 60)}` : display.label,
        subtitle: part.toolName,
        bucket: toolBucket(part.toolName),
        status: toolStatus(part.state),
        start: cursor,
        end: cursor,
        call: {
          id: part.toolCallId,
          name: part.toolName,
          state: part.state,
          args: part.args,
          output: part.output,
          summary: part.summary,
          error: part.error,
        },
        searchText: buildSearchText([
          display.label,
          target,
          part.toolName,
          part.summary,
          part.error,
          argsText(part.args),
          outputText(part.output).slice(0, 1200),
        ]),
      });
    }
  }

  // 收尾节点：错误优先，其次助手正文（工具跑完但没正文时也留一张空回复卡）
  const replyText = assistant?.content ?? "";
  if (status === "error" && run?.error) {
    nodes.push({
      id: `ne:${owner}`,
      kind: "error",
      laneId: "main",
      turnId,
      depth: 0,
      title: t("trace.failed"),
      subtitle: compactPreview(run.error, 80),
      status: "error",
      start: turnEnd ?? cursor,
      end: turnEnd ?? cursor,
      text: run.error,
      searchText: buildSearchText([t("trace.failed"), run.error]),
    });
  } else if (assistant) {
    nodes.push({
      id: `nr:${owner}`,
      kind: "reply",
      laneId: "main",
      turnId,
      depth: 0,
      title: t("trace.assistantReply"),
      subtitle: compactPreview(replyText, 72) || (status === "stopped" ? t("trace.stopped") : undefined),
      status,
      start: turnEnd ?? cursor,
      end: turnEnd ?? cursor,
      // 回复节点不代表单步耗时：整轮时长留在 turn 上，避免「慢步骤」把回复算进去
      text: replyText,
      searchText: buildSearchText([t("trace.assistantReply"), replyText]),
    });
  }

  return {
    sig: assistant ? signatureOf(assistant) : signatureOf(pair.user),
    nodes,
    startedAt: turnStart,
    endedAt: turnEnd,
    status,
    usage: run?.usage,
  };
}

/** 一轮的构建带缓存：key 用这条消息对象，签名一致就复用（流式时只有最后一条在变） */
function fragmentOf(pair: MessagePair): TurnFragment {
  const key = pair.assistant ?? pair.user;
  if (!key) {
    return buildTurnFragment(pair);
  }
  const cached = fragmentCache.get(key);
  const sig = signatureOf(key);
  if (cached && cached.sig === sig) {
    return cached;
  }
  const next = buildTurnFragment(pair);
  next.sig = sig;
  fragmentCache.set(key, next);
  return next;
}

export function buildTraceDocument(messages: readonly ChatMessage[]): TraceDocument {
  const { t } = i18n.global;
  const nodesById: Record<string, TraceNode> = {};
  const orderedNodeIds: string[] = [];
  const turns: TraceTurn[] = [];
  const turnsById: Record<string, TraceTurn> = {};
  const pairs = pairMessages(messages);

  const lane: TraceLane = {
    id: "main",
    name: t("trace.laneMain"),
    kind: "main",
    status: "done",
    stepCount: 0,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingCount = 0;
  let toolCount = 0;
  let failedCount = 0;
  let slowCount = 0;

  pairs.forEach((pair, index) => {
    const fragment = fragmentOf(pair);
    const turnId = fragment.nodes[0]?.turnId ?? `turn:${pair.assistant?.id ?? pair.user?.id ?? index}`;
    const turnDuration =
      fragment.endedAt !== undefined && fragment.endedAt >= fragment.startedAt
        ? fragment.endedAt - fragment.startedAt
        : undefined;

    if (fragment.usage) {
      inputTokens += fragment.usage.inputTokens;
      outputTokens += fragment.usage.outputTokens;
    }

    for (const node of fragment.nodes) {
      nodesById[node.id] = node;
      orderedNodeIds.push(node.id);
      if (node.kind === "thinking") {
        thinkingCount += 1;
      } else if (node.kind === "tool") {
        toolCount += 1;
      }
      if (node.status === "error") {
        failedCount += 1;
      }
      if (node.durationMs !== undefined && node.durationMs >= SLOW_STEP_MS) {
        slowCount += 1;
      }
    }
    lane.stepCount += fragment.nodes.length;

    turns.push({
      id: turnId,
      laneId: "main",
      index: index + 1,
      label: t("trace.turnN", { n: index + 1 }),
      startedAt: fragment.startedAt,
      endedAt: fragment.endedAt,
      durationMs: turnDuration,
      status: fragment.status,
      usage: fragment.usage,
      nodeIds: fragment.nodes.map((node) => node.id),
      requestNodeIds: [],
      waves: buildWaves(fragment.nodes, turnId),
    });
    turnsById[turnId] = turns[turns.length - 1]!;
  });

  const firstStart = turns
    .map((turn) => turn.startedAt)
    .filter((value): value is number => value !== undefined);
  // 没有 meta.run 的历史消息没有 turn 结束时间，用节点末端兜底
  const nodeEnds = orderedNodeIds
    .map((id) => nodesById[id]?.end ?? nodesById[id]?.start)
    .filter((value): value is number => value !== undefined);
  const timedEnds = [
    ...turns.map((turn) => turn.endedAt ?? turn.startedAt),
    ...nodeEnds,
  ].filter((value): value is number => value !== undefined);
  const from = firstStart.length ? Math.min(...firstStart) : (messages[0]?.createdAt ?? 0);
  const to = timedEnds.length ? Math.max(...timedEnds) : from;

  lane.status = turns.some((turn) => turn.status === "error")
    ? "error"
    : turns.some((turn) => turn.status === "running")
      ? "running"
      : "done";
  lane.durationMs = to > from ? to - from : undefined;

  return {
    scope: "session",
    title: t("trace.panelTitle"),
    from,
    to,
    lanes: [lane],
    lanesById: { main: lane },
    turns,
    turnsById,
    nodesById,
    orderedNodeIds,
    rootTurnIds: turns.map((turn) => turn.id),
    stats: {
      turns: turns.length,
      thinkingCount,
      toolCount,
      failedCount,
      slowCount,
      requestCount: 0,
      inputTokens,
      outputTokens,
    },
  };
}

/** 会话信息栏入口行用：轮次数与工具调用数 */
export function countSessionTrace(messages: readonly ChatMessage[]): { turns: number; tools: number } {
  let turns = 0;
  let tools = 0;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    turns += 1;
    for (const part of partsOf(message)) {
      if (part.type === "tool") {
        tools += 1;
      }
    }
  }
  return { turns, tools };
}
