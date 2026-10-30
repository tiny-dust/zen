import { createHash } from "node:crypto";

import type { AgentStreamEvent, ModelTokenUsage, ProviderUsageSnapshot } from "@zen/shared";

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

  getDb().prepare(`
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
  `).run(providerId, accountKey, modelId, localDay(at), inputTokens, outputTokens, cachedInputTokens, at);
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
