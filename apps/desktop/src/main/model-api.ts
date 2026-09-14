import { inspectModelCapabilities } from "./model-capabilities";
import {
  getSelection,
  loadProviderApiKey,
  normalizeBaseUrl,
  resolveAnthropicModelsUrl,
  resolveOpenAiModelsUrl,
} from "./model-db";

import type {
  FetchModelsResult,
  ModelCapabilities,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

async function fetchJson(url: string, init: RequestInit, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const err = (data as { error?: { message?: string } | string } | null)?.error;
      const message =
        typeof err === "string"
          ? err
          : err?.message || (data as { message?: string } | null)?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function mapOpenAiModels(data: unknown): FetchModelsResult {
  const payload = data as { data?: Array<{ id?: string; owned_by?: string }> };
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const models = list
    .map((item) => {
      const id = item.id?.trim();
      if (!id) {
        return null;
      }
      const capabilities: ModelCapabilities = inspectModelCapabilities(id);
      return {
        id,
        name: id,
        capabilities,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return { models, fetchedAt: Date.now() };
}

function mapAnthropicModels(data: unknown): FetchModelsResult {
  const payload = data as {
    data?: Array<{ id?: string; display_name?: string }>;
  };
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const models = list
    .map((item) => {
      const id = item.id?.trim();
      if (!id) {
        return null;
      }
      return {
        id,
        name: item.display_name?.trim() || id,
        capabilities: inspectModelCapabilities(id),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return { models, fetchedAt: Date.now() };
}

export async function fetchModelsFromProvider(provider: ProviderSummary): Promise<FetchModelsResult> {
  const apiKey = await loadProviderApiKey(provider.id);
  const protocol = provider.protocol as ProviderProtocol;

  if (protocol === "anthropic-messages") {
    const url = resolveAnthropicModelsUrl(provider.baseUrl);
    const data = await fetchJson(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
        "User-Agent": "zen-desktop",
      },
    });
    return mapAnthropicModels(data);
  }

  const url = resolveOpenAiModelsUrl(provider.baseUrl);
  const data = await fetchJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "zen-desktop",
    },
  });
  return mapOpenAiModels(data);
}

export async function inspectRemoteModel(
  providerId: string,
  modelId: string,
): Promise<ModelCapabilities> {
  const selection = await getSelection();
  void selection;
  // 优先本地目录 + 启发式；若供应商支持 GET /models/{id} 可后续扩展
  return inspectModelCapabilities(modelId);
}

export { normalizeBaseUrl };
