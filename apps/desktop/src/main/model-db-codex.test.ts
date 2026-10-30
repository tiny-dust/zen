import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHATGPT_PROVIDER_BASE_URL, ensureChatGptProvider, syncChatGptModels } from "./model-db";

let db: Database.Database;
vi.mock("./model-db-connection", () => ({ getDb: () => db }));
vi.mock("./model-capabilities", () => ({
  inspectModelCapabilities: () => ({}),
  prettyModelName: (id: string) => id,
  resolveModelCapabilities: (_id: string, value?: object) => value ?? {},
}));

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE model_providers (
      id TEXT PRIMARY KEY, name TEXT, protocol TEXT, base_url TEXT,
      api_key_enc TEXT, api_key_mask TEXT, user_agent TEXT, auth_mode TEXT,
      oauth_enc TEXT, enabled INTEGER, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE provider_models (
      provider_id TEXT, id TEXT, name TEXT, enabled INTEGER, custom INTEGER,
      capabilities_json TEXT, created_at INTEGER, updated_at INTEGER,
      PRIMARY KEY(provider_id, id)
    );
  `);
});
afterEach(() => { db.close(); vi.clearAllMocks(); });

describe("Codex provider catalog", () => {
  it("creates a public Responses provider without unverified model seeds", async () => {
    const provider = await ensureChatGptProvider();
    expect(provider).toMatchObject({
      name: "Codex", protocol: "openai-responses", baseUrl: CHATGPT_PROVIDER_BASE_URL,
      authMode: "chatgpt-oauth", models: [],
    });
  });

  it("migrates an old default and replaces stale account models while preserving custom models", async () => {
    db.prepare(`INSERT INTO model_providers
      (id, name, protocol, base_url, api_key_enc, api_key_mask, auth_mode, enabled, created_at, updated_at)
      VALUES ('old', 'ChatGPT', 'openai-responses', 'https://chatgpt.com/backend-api/codex', '', '', 'chatgpt-oauth', 1, 1, 1)`).run();
    const insert = db.prepare(`INSERT INTO provider_models
      (provider_id, id, name, enabled, custom, capabilities_json, created_at, updated_at)
      VALUES ('old', ?, ?, 1, ?, '{}', 1, 1)`);
    insert.run("gpt-5.1-codex", "Old seed", 0);
    insert.run("my-model", "Custom", 1);

    const migrated = await ensureChatGptProvider("old");
    expect(migrated).toMatchObject({ name: "Codex", baseUrl: CHATGPT_PROVIDER_BASE_URL });

    const synced = await syncChatGptModels("old", {
      models: [{ id: "gpt-6.1-sol", name: "GPT 6.1 Sol", capabilities: { reasoning: true } }],
      fetchedAt: Date.now(),
    });
    expect(synced.models.map((model) => model.id).sort()).toEqual(["gpt-6.1-sol", "my-model"]);
    expect(synced.models.find((model) => model.id === "gpt-6.1-sol")?.capabilities?.reasoning).toBe(true);
  });
});
