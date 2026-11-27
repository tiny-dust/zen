import { createHash } from "node:crypto";

import type {
  AgentStreamEvent,
  ModelTokenUsage,
  ProviderUsageSnapshot,
  UsageLedger,
  UsageLedgerEvent,
  UsageLedgerFilter,
  UsageLedgerModel,
  UsageLedgerSession,
  UsageTotals,
} from "@zen/shared";

import { getDb } from "./model-db-connection";

type UsageEvent = Extract<AgentStreamEvent, { type: "usage" }>;

/** 优先用账号 ID；缺失时用邮箱散列作稳定隔离键，避免把邮箱明文写入统计表。 */
export function chatGptUsageAccountKey(accountId?: string, email?: string): string | null {
  const id = accountId?.trim();
  if (id) return `account:${id}`;
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) {
    return `email:${createHash("sha256").update(normalizedEmail).digest("hex")}`;
  }
  return null;
}

interface UsageRow {
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  usage_events: number;
  today_input_tokens: number;
  today_output_tokens: number;
  today_cached_input_tokens: number;
  today_usage_events: number;
  updated_at: number;
}

function localDay(at: number): string {
  const date = new Date(at);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyUsage(): ModelTokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 };
}

function addUsage(total: ModelTokenUsage, usage: ModelTokenUsage): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.cachedInputTokens += usage.cachedInputTokens;
  total.totalTokens += usage.totalTokens;
  total.usageEvents += usage.usageEvents;
}

/** 每个 finish-step 只落一次真实 usage；不会把流中的中间值或最后一次消息摘要重复累计。 */
export function recordProviderUsage(
  providerId: string,
  modelId: string,
  usage: UsageEvent,
  at = Date.now(),
  accountKey = "",
  sessionId = "",
): void {
  const { inputTokens, outputTokens } = usage;
  if (
    !providerId || !modelId || !Number.isFinite(at) ||
    !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) || outputTokens < 0 ||
    !Number.isSafeInteger(inputTokens + outputTokens)
  ) return;
  if (inputTokens + outputTokens === 0) return;

  const cached = usage.cachedInputTokens;
  const cachedInputTokens =
    cached !== undefined && Number.isSafeInteger(cached) && cached >= 0 && cached <= inputTokens
      ? cached
      : 0;

  const day = localDay(at);
  const db = getDb();
  // 聚合表与明细账同一事务：任一处失败都不会留下半边数据
  db.transaction(() => {
    db.prepare(`
      INSERT INTO provider_model_usage
        (provider_id, account_key, model_id, local_day, input_tokens, output_tokens,
         cached_input_tokens, usage_events, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(provider_id, account_key, model_id, local_day) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
        usage_events = usage_events + 1,
        updated_at = excluded.updated_at
    `).run(providerId, accountKey, modelId, day, inputTokens, outputTokens, cachedInputTokens, at);
    db.prepare(`
      INSERT INTO usage_events
        (ts, local_day, provider_id, account_key, model_id, session_id, source,
         input_tokens, output_tokens, cached_input_tokens)
      VALUES (?, ?, ?, ?, ?, ?, 'api', ?, ?, ?)
    `).run(at, day, providerId, accountKey, modelId, sessionId, inputTokens, outputTokens, cachedInputTokens);
  })();
}

/** 窗口起点（含今天往前 days-1 天）；0/非法值返回 null 表示不设下界 */
export function usageWindowStartDay(days: number, at = Date.now()): string | null {
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Math.floor(days) - 1));
  return localDay(start.getTime());
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, events: 0 };
}

function totalsOf(row: {
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  events: number | null;
}): UsageTotals {
  const inputTokens = row.input_tokens ?? 0;
  const outputTokens = row.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: row.cached_input_tokens ?? 0,
    totalTokens: inputTokens + outputTokens,
    events: row.events ?? 0,
  };
}

/**
 * 用量账本：在明细表上做「窗口 + 供应商/模型」筛选后的汇总与最近记录。
 * 只看真实上报的 usage；没有价格数据，所以不产出费用估算（estimatedCost 恒为 null）。
 */
export function queryUsageLedger(filter: UsageLedgerFilter = {}, at = Date.now()): UsageLedger {
  const days = Number.isFinite(filter.days ?? 0) ? Math.max(0, Math.floor(filter.days ?? 0)) : 0;
  const fromDay = usageWindowStartDay(days, at);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (fromDay) {
    conditions.push("local_day >= ?");
    params.push(fromDay);
  }
  if (filter.providerId) {
    conditions.push("provider_id = ?");
    params.push(filter.providerId);
  }
  if (filter.modelId) {
    conditions.push("model_id = ?");
    params.push(filter.modelId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = getDb();

  const totalRow = db.prepare(`
    SELECT SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      COUNT(*) AS events
    FROM usage_events ${where}
  `).get(...params) as Parameters<typeof totalsOf>[0] | undefined;

  const byModelRows = db.prepare(`
    SELECT provider_id, model_id,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      COUNT(*) AS events
    FROM usage_events ${where}
    GROUP BY provider_id, model_id
    ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC, model_id
  `).all(...params) as Array<Parameters<typeof totalsOf>[0] & { provider_id: string; model_id: string }>;

  const bySessionRows = db.prepare(`
    SELECT session_id,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      COUNT(*) AS events
    FROM usage_events ${where}
    GROUP BY session_id
    ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC
    LIMIT 50
  `).all(...params) as Array<Parameters<typeof totalsOf>[0] & { session_id: string }>;

  const recentRows = db.prepare(`
    SELECT ts, provider_id, model_id, session_id, input_tokens, output_tokens, cached_input_tokens
    FROM usage_events ${where}
    ORDER BY ts DESC, id DESC
    LIMIT 100
  `).all(...params) as Array<{
    ts: number;
    provider_id: string;
    model_id: string;
    session_id: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  }>;

  const byModel: UsageLedgerModel[] = byModelRows.map((row) => ({
    providerId: row.provider_id,
    modelId: row.model_id,
    ...totalsOf(row),
  }));
  const bySession: UsageLedgerSession[] = bySessionRows.map((row) => ({
    sessionId: row.session_id,
    ...totalsOf(row),
  }));
  const recent: UsageLedgerEvent[] = recentRows.map((row) => ({
    ts: row.ts,
    providerId: row.provider_id,
    modelId: row.model_id,
    sessionId: row.session_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
  }));

  return {
    days,
    estimatedCost: null,
    totals: totalRow ? totalsOf(totalRow) : emptyTotals(),
    byModel,
    bySession,
    recent,
  };
}

/** 今日按设备当前时区的自然日；历史日期按写入时设备时区归档。 */
export function getProviderUsage(providerId: string, at = Date.now(), accountKey = ""): ProviderUsageSnapshot {
  const rows = getDb().prepare(`
    SELECT model_id,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      SUM(usage_events) AS usage_events,
      SUM(CASE WHEN local_day = ? THEN input_tokens ELSE 0 END) AS today_input_tokens,
      SUM(CASE WHEN local_day = ? THEN output_tokens ELSE 0 END) AS today_output_tokens,
      SUM(CASE WHEN local_day = ? THEN cached_input_tokens ELSE 0 END) AS today_cached_input_tokens,
      SUM(CASE WHEN local_day = ? THEN usage_events ELSE 0 END) AS today_usage_events,
      MAX(updated_at) AS updated_at
    FROM provider_model_usage
    WHERE provider_id = ? AND account_key = ?
    GROUP BY model_id
    ORDER BY input_tokens + output_tokens DESC, model_id
  `).all(localDay(at), localDay(at), localDay(at), localDay(at), providerId, accountKey) as UsageRow[];

  const total = emptyUsage();
  const today = emptyUsage();
  let updatedAt: number | null = null;
  const byModel = rows.map((row) => {
    const usage: ModelTokenUsage = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      totalTokens: row.input_tokens + row.output_tokens,
      usageEvents: row.usage_events,
    };
    addUsage(total, usage);
    addUsage(today, {
      inputTokens: row.today_input_tokens,
      outputTokens: row.today_output_tokens,
      cachedInputTokens: row.today_cached_input_tokens,
      totalTokens: row.today_input_tokens + row.today_output_tokens,
      usageEvents: row.today_usage_events,
    });
    updatedAt = Math.max(updatedAt ?? 0, row.updated_at);
    return { modelId: row.model_id, usage };
  });

  return { providerId, source: "local", total, today, byModel, updatedAt };
}
