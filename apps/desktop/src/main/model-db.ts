import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { app } from "electron";

import type {
  AddModelInput,
  ModelCapabilities,
  ModelSelection,
  ProviderInput,
  ProviderModel,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

import { inspectModelCapabilities, prettyModelName } from "./model-capabilities";
import { decryptSecret, encryptSecret, maskSecret } from "./secret";

interface ProviderRow {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  api_key_enc: string;
  api_key_mask: string;
  created_at: number;
  updated_at: number;
}

interface ModelRow {
  provider_id: string;
  id: string;
  name: string;
  capabilities_json: string | null;
  created_at: number;
  updated_at: number;
}

let db: Database.Database | null = null;

function dbPath(): string {
  const dir = join(app.getPath("userData"), "db");
  mkdirSync(dir, { recursive: true });
  return join(dir, "zen.sqlite");
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(conn: Database.Database) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      api_key_mask TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_models (
      provider_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      capabilities_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider_id, id),
      FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_selection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider_id TEXT,
      model_id TEXT
    );
  `);

  const columns = conn.prepare(`PRAGMA table_info(model_providers)`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((col) => col.name === "api_key_mask")) {
    conn.exec(`ALTER TABLE model_providers ADD COLUMN api_key_mask TEXT NOT NULL DEFAULT ''`);
  }
}

function parseCapabilities(json: string | null): ModelCapabilities | undefined {
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as ModelCapabilities;
  } catch {
    return undefined;
  }
}

function toProviderSummary(row: ProviderRow, models: ProviderModel[]): ProviderSummary {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as ProviderProtocol,
    baseUrl: row.base_url,
    hasApiKey: Boolean(row.api_key_enc),
    apiKeyMask: row.api_key_mask || "••••",
    models,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listModels(providerId: string): ProviderModel[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM provider_models WHERE provider_id = ? ORDER BY name COLLATE NOCASE ASC`,
    )
    .all(providerId) as ModelRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    capabilities: parseCapabilities(row.capabilities_json),
  }));
}

export function normalizeBaseUrl(url: string): string {
  let next = url.trim().replace(/\/+$/, "");
  if (!next) {
    return "";
  }
  if (!/^https?:\/\//i.test(next)) {
    next = `https://${next}`;
  }
  return next;
}

export function resolveOpenAiModelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/v\d+$/.test(base)) {
    return `${base}/models`;
  }
  return `${base}/v1/models`;
}

export function resolveAnthropicModelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/v\d+$/.test(base)) {
    return `${base}/models`;
  }
  return `${base}/v1/models`;
}

export async function listProviders(): Promise<ProviderSummary[]> {
  const rows = getDb()
    .prepare(`SELECT * FROM model_providers ORDER BY created_at ASC`)
    .all() as ProviderRow[];
  return rows.map((row) => toProviderSummary(row, listModels(row.id)));
}

export async function getSelection(): Promise<
  ModelSelection & { provider?: ProviderSummary; model?: ProviderModel }
> {
  const row = getDb()
    .prepare(`SELECT provider_id, model_id FROM model_selection WHERE id = 1`)
    .get() as { provider_id: string | null; model_id: string | null } | undefined;

  const providers = await listProviders();
  const provider = providers.find((p) => p.id === row?.provider_id) ?? providers[0];
  if (!provider) {
    return { providerId: null, modelId: null };
  }
  const model = provider.models.find((m) => m.id === row?.model_id) ?? provider.models[0];
  return {
    providerId: provider.id,
    modelId: model?.id ?? null,
    provider,
    model,
  };
}

export async function setSelection(providerId: string | null, modelId: string | null) {
  getDb()
    .prepare(
      `INSERT INTO model_selection (id, provider_id, model_id) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id`,
    )
    .run(providerId, modelId);
  return getSelection();
}

export async function addProvider(input: ProviderInput): Promise<ProviderSummary> {
  const name = input.name.trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!name) {
    throw new Error("请填写供应商名称");
  }
  if (!baseUrl) {
    throw new Error("请填写 Base URL");
  }
  if (!input.apiKey?.trim()) {
    throw new Error("请填写 API Key");
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const plainKey = input.apiKey.trim();
  const apiKeyEnc = await encryptSecret(plainKey);
  const apiKeyMask = maskSecret(plainKey);

  getDb()
    .prepare(
      `INSERT INTO model_providers
        (id, name, protocol, base_url, api_key_enc, api_key_mask, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, input.protocol, baseUrl, apiKeyEnc, apiKeyMask, now, now);

  const rows = getDb().prepare(`SELECT * FROM model_providers WHERE id = ?`).all(id) as ProviderRow[];
  return toProviderSummary(rows[0]!, []);
}

export async function updateProvider(
  id: string,
  patch: Partial<ProviderInput>,
): Promise<ProviderSummary> {
  const row = getDb().prepare(`SELECT * FROM model_providers WHERE id = ?`).get(id) as
    | ProviderRow
    | undefined;
  if (!row) {
    throw new Error("供应商不存在");
  }

  const name = patch.name?.trim() || row.name;
  const baseUrl = patch.baseUrl ? normalizeBaseUrl(patch.baseUrl) : row.base_url;
  const protocol = patch.protocol || (row.protocol as ProviderProtocol);
  let apiKeyEnc = row.api_key_enc;
  let apiKeyMask = row.api_key_mask;
  if (patch.apiKey?.trim()) {
    const plainKey = patch.apiKey.trim();
    apiKeyEnc = await encryptSecret(plainKey);
    apiKeyMask = maskSecret(plainKey);
  }
  const now = Date.now();

  getDb()
    .prepare(
      `UPDATE model_providers
       SET name = ?, protocol = ?, base_url = ?, api_key_enc = ?, api_key_mask = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(name, protocol, baseUrl, apiKeyEnc, apiKeyMask, now, id);

  return toProviderSummary(
    {
      ...row,
      name,
      protocol,
      base_url: baseUrl,
      api_key_enc: apiKeyEnc,
      api_key_mask: apiKeyMask,
      updated_at: now,
    },
    listModels(id),
  );
}

export async function removeProvider(id: string): Promise<void> {
  getDb().prepare(`DELETE FROM model_providers WHERE id = ?`).run(id);
  const selection = getDb()
    .prepare(`SELECT provider_id FROM model_selection WHERE id = 1`)
    .get() as { provider_id: string | null } | undefined;
  if (selection?.provider_id === id) {
    await setSelection(null, null);
  }
}

export async function addModel(input: AddModelInput): Promise<ProviderSummary> {
  const modelId = input.id.trim();
  if (!modelId) {
    throw new Error("请填写模型 ID");
  }
  const provider = getDb()
    .prepare(`SELECT id FROM model_providers WHERE id = ?`)
    .get(input.providerId);
  if (!provider) {
    throw new Error("供应商不存在");
  }

  const capabilities = input.capabilities || inspectModelCapabilities(modelId);
  const name = input.name?.trim() || prettyModelName(modelId);
  const now = Date.now();

  getDb()
    .prepare(
      `INSERT INTO provider_models (provider_id, id, name, capabilities_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, id) DO UPDATE SET
         name = excluded.name,
         capabilities_json = excluded.capabilities_json,
         updated_at = excluded.updated_at`,
    )
    .run(input.providerId, modelId, name, JSON.stringify(capabilities), now, now);

  const selection = await getSelection();
  if (!selection.modelId || selection.providerId !== input.providerId) {
    await setSelection(input.providerId, modelId);
  }

  const providers = await listProviders();
  return providers.find((p) => p.id === input.providerId)!;
}

export async function removeModel(providerId: string, modelId: string): Promise<ProviderSummary> {
  getDb()
    .prepare(`DELETE FROM provider_models WHERE provider_id = ? AND id = ?`)
    .run(providerId, modelId);
  const selection = getDb()
    .prepare(`SELECT provider_id, model_id FROM model_selection WHERE id = 1`)
    .get() as { provider_id: string | null; model_id: string | null } | undefined;
  if (selection?.provider_id === providerId && selection?.model_id === modelId) {
    await setSelection(providerId, null);
  }
  const providers = await listProviders();
  return providers.find((p) => p.id === providerId)!;
}

export async function loadProviderApiKey(providerId: string): Promise<string> {
  const row = getDb()
    .prepare(`SELECT api_key_enc FROM model_providers WHERE id = ?`)
    .get(providerId) as { api_key_enc: string } | undefined;
  if (!row?.api_key_enc) {
    throw new Error("供应商未配置 API Key");
  }
  return decryptSecret(row.api_key_enc);
}
