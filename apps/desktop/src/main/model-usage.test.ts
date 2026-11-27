import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatGptUsageAccountKey,
  getProviderUsage,
  queryUsageLedger,
  recordProviderUsage,
  usageWindowStartDay,
} from "./model-usage";

let db: Database.Database;
vi.mock("./model-db-connection", () => ({ getDb: () => db }));

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE provider_model_usage (
      provider_id TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      local_day TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      usage_events INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider_id, account_key, model_id, local_day)
    );
    CREATE TABLE usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      local_day TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'api',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);
});

afterEach(() => db.close());

describe("provider usage", () => {
  it("sums completed model steps per provider and model, with today scoped to the local day", () => {
    const today = new Date(2026, 9, 30, 12).getTime();
    const yesterday = new Date(2026, 9, 29, 12).getTime();
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s1", inputTokens: 100, outputTokens: 20, cachedInputTokens: 80,
    }, today);
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s1", inputTokens: 50, outputTokens: 10, cachedInputTokens: 30,
    }, today + 1000);
    recordProviderUsage("codex", "gpt-b", {
      type: "usage", sessionId: "s2", inputTokens: 40, outputTokens: 5,
    }, yesterday);
    recordProviderUsage("other", "gpt-a", {
      type: "usage", sessionId: "s3", inputTokens: 900, outputTokens: 900,
    }, today);

    expect(getProviderUsage("codex", today + 2000)).toEqual({
      providerId: "codex",
      source: "local",
      total: { inputTokens: 190, outputTokens: 35, cachedInputTokens: 110, totalTokens: 225, usageEvents: 3 },
      today: { inputTokens: 150, outputTokens: 30, cachedInputTokens: 110, totalTokens: 180, usageEvents: 2 },
      byModel: [
        { modelId: "gpt-a", usage: { inputTokens: 150, outputTokens: 30, cachedInputTokens: 110, totalTokens: 180, usageEvents: 2 } },
        { modelId: "gpt-b", usage: { inputTokens: 40, outputTokens: 5, cachedInputTokens: 0, totalTokens: 45, usageEvents: 1 } },
      ],
      updatedAt: today + 1000,
    });
  });

  it("ignores invalid or zero usage and returns an empty snapshot for a new provider", () => {
    const at = new Date(2026, 9, 30, 12).getTime();
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s", inputTokens: 0, outputTokens: 0,
    }, at);
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s", inputTokens: -1, outputTokens: 3,
    }, at);
    expect(getProviderUsage("codex", at)).toEqual({
      providerId: "codex",
      source: "local",
      total: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
      today: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, usageEvents: 0 },
      byModel: [],
      updatedAt: null,
    });
  });

  it("isolates usage when the same OAuth provider changes ChatGPT accounts", () => {
    const at = new Date(2026, 9, 30, 12).getTime();
    const first = chatGptUsageAccountKey("account-a");
    const second = chatGptUsageAccountKey("account-b");
    if (!first || !second) throw new Error("Expected account keys");
    expect(first).not.toBe(second);
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s1", inputTokens: 100, outputTokens: 20,
    }, at, first);
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s2", inputTokens: 40, outputTokens: 5,
    }, at, second);

    expect(getProviderUsage("codex", at, first).total.totalTokens).toBe(120);
    expect(getProviderUsage("codex", at, second).total.totalTokens).toBe(45);
    expect(getProviderUsage("codex", at).total.totalTokens).toBe(0);
  });

  it("uses a stable non-plaintext email key when account ID is unavailable", () => {
    expect(chatGptUsageAccountKey(undefined, " Person@Example.com ")).toBe(
      chatGptUsageAccountKey(undefined, "person@example.com"),
    );
    expect(chatGptUsageAccountKey(undefined, "person@example.com")).not.toContain("person@example.com");
    expect(chatGptUsageAccountKey()).toBeNull();
  });
});

describe("usage ledger", () => {
  const day = (offset: number) => new Date(2026, 9, 30 - offset, 12).getTime();

  function seed() {
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s1", inputTokens: 100, outputTokens: 20, cachedInputTokens: 80,
    }, day(0), "", "s1");
    recordProviderUsage("codex", "gpt-a", {
      type: "usage", sessionId: "s1", inputTokens: 50, outputTokens: 10, cachedInputTokens: 30,
    }, day(0) + 1000, "", "s1");
    recordProviderUsage("codex", "gpt-b", {
      type: "usage", sessionId: "s2", inputTokens: 40, outputTokens: 5, cachedInputTokens: 0,
    }, day(5), "", "s2");
    recordProviderUsage("other", "model-x", {
      type: "usage", sessionId: "s3", inputTokens: 7, outputTokens: 3, cachedInputTokens: 0,
    }, day(40), "", "s3");
  }

  it("明细与聚合各记一次，不重复计数", () => {
    seed();
    const ledger = queryUsageLedger({}, day(0));
    expect(ledger.totals).toEqual({
      inputTokens: 197, outputTokens: 38, cachedInputTokens: 110, totalTokens: 235, events: 4,
    });
    // 聚合表与账本来自同一次调用，累计值一致
    const snapshot = getProviderUsage("codex", day(0));
    expect(snapshot.total.inputTokens).toBe(190);
    expect(snapshot.total.outputTokens).toBe(35);
    expect(snapshot.total.usageEvents).toBe(3);
  });

  it("按会话汇总并保留非零会话归属", () => {
    seed();
    const ledger = queryUsageLedger({ days: 0 }, day(0));
    expect(ledger.bySession.map((row) => [row.sessionId, row.events, row.totalTokens])).toEqual([
      ["s1", 2, 180],
      ["s2", 1, 45],
      ["s3", 1, 10],
    ]);
  });

  it("时间窗口只统计最近 N 个自然日（含今天）", () => {
    seed();
    const week = queryUsageLedger({ days: 7 }, day(0));
    expect(week.totals.events).toBe(3);
    expect(week.totals.inputTokens).toBe(190);
    expect(queryUsageLedger({ days: 0 }, day(0)).totals.events).toBe(4);
  });

  it("供应商筛选只看该供应商，且不产出费用估算", () => {
    seed();
    const only = queryUsageLedger({ providerId: "other" }, day(0));
    expect(only.totals.inputTokens).toBe(7);
    expect(only.byModel.map((row) => row.modelId)).toEqual(["model-x"]);
    expect(only.estimatedCost).toBeNull();
  });

  it("窗口起点按自然日计算", () => {
    expect(usageWindowStartDay(0)).toBeNull();
    expect(usageWindowStartDay(1, day(0))).toBe("2026-10-30");
    expect(usageWindowStartDay(3, day(0))).toBe("2026-10-28");
  });
});
