/**
 * 轨迹查询与统计（纯函数）：全文检索、类型过滤、思考脉络提取、耗时构成与工具分布。
 * 算法与 Nomi 的 TraceDrawer/queries.ts 对齐，去掉 Zen 不存在的子代理 / 网关分支。
 */
import {
  SLOW_STEP_MS,
  baseToolName,
  type TraceDocument,
  type TraceLane,
  type TraceNode,
  type TraceTurn,
} from "./document";

export type TraceKindFilter = "all" | "thinking" | "tool" | "error" | "slow";

export interface TraceFilter {
  query: string;
  kind: TraceKindFilter;
}

export interface TraceFilterResult {
  active: boolean;
  matchedIds: Set<string>;
  orderedMatches: string[];
  visibleTurnIds: Set<string>;
}

function termsOf(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** 过滤 + 检索：小写、按空格拆词、全部命中（AND）、haystack = searchText + laneName */
export function filterTraceDocument(doc: TraceDocument, filter: TraceFilter): TraceFilterResult {
  const terms = termsOf(filter.query);
  const active = terms.length > 0 || filter.kind !== "all";
  const matchedIds = new Set<string>();
  const orderedMatches: string[] = [];
  const visibleTurnIds = new Set<string>();

  for (const id of doc.orderedNodeIds) {
    const node = doc.nodesById[id];
    if (!node) {
      continue;
    }
    if (filter.kind === "thinking" && node.kind !== "thinking") {
      continue;
    }
    if (filter.kind === "tool" && node.kind !== "tool") {
      continue;
    }
    if (filter.kind === "error" && node.status !== "error") {
      continue;
    }
    if (
      filter.kind === "slow" &&
      !(node.durationMs !== undefined && node.durationMs >= SLOW_STEP_MS)
    ) {
      continue;
    }
    if (terms.length > 0) {
      const laneName = doc.lanesById[node.laneId]?.name.toLowerCase() ?? "";
      const haystack = `${node.searchText} ${laneName}`;
      if (!terms.every((term) => haystack.includes(term))) {
        continue;
      }
    }
    matchedIds.add(id);
    orderedMatches.push(id);
    if (node.turnId) {
      visibleTurnIds.add(node.turnId);
    }
  }

  return { active, matchedIds, orderedMatches, visibleTurnIds };
}

export interface ThinkingChainItem {
  node: TraceNode;
  lane: TraceLane;
  turn: TraceTurn;
  stepIndex: number;
  summary: string;
  triggeredActions: TraceNode[];
}

/** 按发生顺序提取思考脉络：每段思考挂上它之后触发的工具 / 失败操作 */
export function extractThinkingChain(
  doc: TraceDocument,
  filter?: TraceFilterResult,
): ThinkingChainItem[] {
  const items: ThinkingChainItem[] = [];
  const visited = new Set<string>();
  let stepIndex = 0;

  for (const turnId of doc.rootTurnIds) {
    if (visited.has(turnId)) {
      continue;
    }
    visited.add(turnId);
    const turn = doc.turnsById[turnId];
    if (!turn) {
      continue;
    }
    const lane = doc.lanesById[turn.laneId];
    if (!lane) {
      continue;
    }
    const nodes = turn.nodeIds
      .map((id) => doc.nodesById[id])
      .filter((node): node is TraceNode => node !== undefined);

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || node.kind !== "thinking") {
        continue;
      }
      if (filter?.active && !filter.matchedIds.has(node.id)) {
        continue;
      }
      const triggered: TraceNode[] = [];
      for (let next = index + 1; next < nodes.length; next += 1) {
        const candidate = nodes[next];
        if (!candidate) {
          continue;
        }
        if (
          candidate.kind === "thinking" ||
          candidate.kind === "reply" ||
          candidate.kind === "user"
        ) {
          break;
        }
        triggered.push(candidate);
      }
      stepIndex += 1;
      items.push({
        node,
        lane,
        turn,
        stepIndex,
        summary: node.title || node.text || "",
        triggeredActions: triggered,
      });
    }
  }

  return items;
}

export interface TraceInsights {
  totalMs: number;
  thinkingMs: number;
  toolMs: number;
  subagentMs: number;
  requestMs: number;
  otherMs: number;
  slowest: TraceNode[];
  failed: TraceNode[];
  toolDistribution: Array<{ name: string; count: number; errors: number; totalMs: number }>;
}

/** 耗时构成与排行：各 kind 时长求和，剩余算「生成与等待」 */
export function computeTraceInsights(doc: TraceDocument): TraceInsights {
  let thinkingMs = 0;
  let toolMs = 0;
  let subagentMs = 0;
  let requestMs = 0;
  const timedSteps: TraceNode[] = [];
  const failed: TraceNode[] = [];
  const toolCounts = new Map<string, { name: string; count: number; errors: number; totalMs: number }>();

  for (const id of doc.orderedNodeIds) {
    const node = doc.nodesById[id];
    if (!node) {
      continue;
    }
    if (node.status === "error") {
      failed.push(node);
    }
    const duration = node.durationMs ?? 0;
    if (node.kind === "thinking") {
      thinkingMs += duration;
    } else if (node.kind === "tool") {
      toolMs += duration;
    }
    // 子代理 0（Zen 没有子代理分段）、网关请求 0（不经过网关）：图例保留但恒为 0

    if (node.kind !== "user" && node.kind !== "reply" && node.durationMs !== undefined) {
      timedSteps.push(node);
    }
    if (node.kind === "tool" && node.call) {
      const key = baseToolName(node.call.name);
      const current = toolCounts.get(key) ?? {
        name: node.call.name,
        count: 0,
        errors: 0,
        totalMs: 0,
      };
      current.count += 1;
      if (node.status === "error") {
        current.errors += 1;
      }
      current.totalMs += duration;
      toolCounts.set(key, current);
    }
  }

  const totalMs = Math.max(1, doc.to - doc.from);
  const tracked = thinkingMs + toolMs + subagentMs;
  const otherMs = Math.max(0, totalMs - tracked);

  const slowest = [...timedSteps]
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 5);

  const toolDistribution = [...toolCounts.values()]
    .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs)
    .slice(0, 8);

  return {
    totalMs,
    thinkingMs,
    toolMs,
    subagentMs,
    requestMs,
    otherMs,
    slowest,
    failed,
    toolDistribution,
  };
}

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** 关键词高亮：与过滤同一套拆词规则，大小写不敏感 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = termsOf(query);
  if (!terms.length || !text) {
    return [{ text, hit: false }];
  }
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: terms.includes(part.toLowerCase()) }));
}
