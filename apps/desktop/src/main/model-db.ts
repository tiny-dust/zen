import type {
  AddModelInput,
  ModelCapabilities,
  ModelSelection,
  ProviderInput,
  ProviderModel,
  ProviderProtocol,
  ProviderSummary,
  SetModelsEnabledInput,
  UpdateModelInput,
} from "@zen/shared";

import { getDb } from "./model-db-connection";
import {
  inspectModelCapabilities,
  prettyModelName,
  resolveModelCapabilities,
} from "./model-capabilities";
import { decryptSecret, encryptSecret, maskSecret } from "./secret";

/** HTTP header 必须是 ByteString（0–255）；含中文/替换符会让 fetch 抛 TypeError */
export function sanitizeUserAgent(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0 && code <= 255 && ch !== "�") {
      out += ch;
    }
  }
  out = out.replace(/[\r\n\0]/g, "").trim();
  return out || null;
}

interface ProviderRow {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  api_key_enc: string;
  api_key_mask: string;
  user_agent: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface ModelRow {
  provider_id: string;
  id: string;
  name: string;
  enabled: number;
  custom: number;
  capabilities_json: string | null;
  created_at: number;
  updated_at: number;
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
    userAgent: row.user_agent || undefined,
    enabled: row.enabled !== 0,
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
    enabled: row.enabled !== 0,
    custom: row.custom !== 0,
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
  const provider = providers.find((p) => p.id === row?.provider_id) ?? providers.find((p) => p.enabled) ?? providers[0];
  if (!provider) {
    return { providerId: null, modelId: null };
  }
  const enabledModels = provider.models.filter((m) => m.enabled);
  const model =
    provider.models.find((m) => m.id === row?.model_id && m.enabled) ??
    enabledModels[0] ??
    provider.models[0];
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

/**
 * 找一个具备视觉能力的已启用模型（图片预分析兜底用）；
 * 优先跳过当前选中模型，避免把任务再发给不支持视觉的模型。
 */
export async function findVisionModel(
  exclude?: { providerId?: string; modelId?: string },
): Promise<{ providerId: string; modelId: string } | null> {
  const providers = await listProviders();
  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }
    for (const model of provider.models) {
      if (!model.enabled) {
        continue;
      }
      if (exclude?.providerId === provider.id && exclude?.modelId === model.id) {
        continue;
      }
      const vision = model.capabilities?.vision ?? inspectModelCapabilities(model.id).vision;
      if (vision === true) {
        return { providerId: provider.id, modelId: model.id };
      }
    }
  }
  return null;
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
  const userAgent = sanitizeUserAgent(input.userAgent);
  const enabled = input.enabled === false ? 0 : 1;

  getDb()
    .prepare(
      `INSERT INTO model_providers
        (id, name, protocol, base_url, api_key_enc, api_key_mask, user_agent, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, input.protocol, baseUrl, apiKeyEnc, apiKeyMask, userAgent, enabled, now, now);

  const insertModel = getDb().prepare(
    `INSERT INTO provider_models (provider_id, id, name, enabled, custom, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, id) DO NOTHING`,
  );
  for (const model of input.models ?? []) {
    const modelId = model.id.trim();
    if (!modelId) {
      continue;
    }
    const capabilities = resolveModelCapabilities(modelId, model.capabilities);
    const modelName = model.name?.trim() || prettyModelName(modelId);
    insertModel.run(
      id,
      modelId,
      modelName,
      model.enabled === false ? 0 : 1,
      model.custom ? 1 : 0,
      JSON.stringify(capabilities),
      now,
      now,
    );
  }

  const rows = getDb().prepare(`SELECT * FROM model_providers WHERE id = ?`).all(id) as ProviderRow[];
  return toProviderSummary(rows[0]!, listModels(id));
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
  const userAgent =
    patch.userAgent !== undefined ? sanitizeUserAgent(patch.userAgent) : row.user_agent;
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled;
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
       SET name = ?, protocol = ?, base_url = ?, api_key_enc = ?, api_key_mask = ?, user_agent = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(name, protocol, baseUrl, apiKeyEnc, apiKeyMask, userAgent, enabled, now, id);

  return toProviderSummary(
    {
      ...row,
      name,
      protocol,
      base_url: baseUrl,
      api_key_enc: apiKeyEnc,
      api_key_mask: apiKeyMask,
      user_agent: userAgent,
      enabled,
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

  const capabilities = resolveModelCapabilities(modelId, input.capabilities);
  const name = input.name?.trim() || prettyModelName(modelId);
  const now = Date.now();

  getDb()
    .prepare(
      `INSERT INTO provider_models (provider_id, id, name, enabled, custom, capabilities_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, id) DO UPDATE SET
         name = excluded.name,
         enabled = excluded.enabled,
         custom = excluded.custom,
         capabilities_json = excluded.capabilities_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.providerId,
      modelId,
      name,
      input.enabled === false ? 0 : 1,
      input.custom ? 1 : 0,
      JSON.stringify(capabilities),
      now,
      now,
    );

  const selection = await getSelection();
  if (!selection.modelId || selection.providerId !== input.providerId) {
    await setSelection(input.providerId, modelId);
  }

  const providers = await listProviders();
  return providers.find((p) => p.id === input.providerId)!;
}

export async function updateModel(input: UpdateModelInput): Promise<ProviderSummary> {
  const row = getDb()
    .prepare(`SELECT * FROM provider_models WHERE provider_id = ? AND id = ?`)
    .get(input.providerId, input.id) as ModelRow | undefined;
  if (!row) {
    throw new Error("模型不存在");
  }

  const now = Date.now();
  const name = input.name?.trim() || row.name;
  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : row.enabled;
  const capabilitiesJson =
    input.capabilities !== undefined ? JSON.stringify(input.capabilities) : row.capabilities_json;

  getDb()
    .prepare(
      `UPDATE provider_models
       SET name = ?, enabled = ?, capabilities_json = ?, updated_at = ?
       WHERE provider_id = ? AND id = ?`,
    )
    .run(name, enabled, capabilitiesJson, now, input.providerId, input.id);

  if (!enabled) {
    const selection = getDb()
      .prepare(`SELECT provider_id, model_id FROM model_selection WHERE id = 1`)
      .get() as { provider_id: string | null; model_id: string | null } | undefined;
    if (selection?.provider_id === input.providerId && selection?.model_id === input.id) {
      await setSelection(input.providerId, null);
    }
  }

  const providers = await listProviders();
  return providers.find((p) => p.id === input.providerId)!;
}

export async function setModelsEnabled(input: SetModelsEnabledInput): Promise<ProviderSummary> {
  if (!input.modelIds.length) {
    const providers = await listProviders();
    return providers.find((p) => p.id === input.providerId)!;
  }
  const stmt = getDb().prepare(
    `UPDATE provider_models SET enabled = ?, updated_at = ? WHERE provider_id = ? AND id = ?`,
  );
  const now = Date.now();
  const tx = getDb().transaction(() => {
    for (const modelId of input.modelIds) {
      stmt.run(input.enabled ? 1 : 0, now, input.providerId, modelId);
    }
  });
  tx();

  if (!input.enabled) {
    const selection = getDb()
      .prepare(`SELECT provider_id, model_id FROM model_selection WHERE id = 1`)
      .get() as { provider_id: string | null; model_id: string | null } | undefined;
    if (
      selection?.provider_id === input.providerId &&
      selection?.model_id &&
      input.modelIds.includes(selection.model_id)
    ) {
      await setSelection(input.providerId, null);
    }
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

export async function loadProviderUserAgent(providerId: string): Promise<string | undefined> {
  const row = getDb()
    .prepare(`SELECT user_agent FROM model_providers WHERE id = ?`)
    .get(providerId) as { user_agent: string | null } | undefined;
  return row?.user_agent || undefined;
}
