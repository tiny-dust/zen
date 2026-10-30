import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatGptUsageAccountKey, getProviderUsage, recordProviderUsage } from "./model-usage";

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
