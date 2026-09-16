import { resolveModelCapabilities } from "./model-capabilities";
import {
  getSelection,
  listProviders,
  loadProviderApiKey,
  loadProviderUserAgent,
  normalizeBaseUrl,
  resolveAnthropicModelsUrl,
  resolveOpenAiModelsUrl,
  sanitizeUserAgent,
} from "./model-db";

import type {
  FetchModelsResult,
  ModelCapabilities,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

const DEFAULT_UA = "zen-desktop";

async function fetchJson(url: string, init: RequestInit, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ByteString")) {
        throw new Error(
          "请求头含非法字符（如中文 User-Agent）。请到设置中改为纯 ASCII 后重试。",
        );
      }
      throw error;
    }
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
      return {
        id,
        name: id,
        capabilities: resolveModelCapabilities(id),
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
        capabilities: resolveModelCapabilities(id),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return { models, fetchedAt: Date.now() };
}

export async function fetchModelsByCredentials(input: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  userAgent?: string;
}): Promise<FetchModelsResult> {
  const protocol = input.protocol;
  const userAgent = sanitizeUserAgent(input.userAgent) || DEFAULT_UA;

  if (protocol === "anthropic-messages") {
    const url = resolveAnthropicModelsUrl(input.baseUrl);
    const data = await fetchJson(url, {
      method: "GET",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    });
    return mapAnthropicModels(data);
  }

  const url = resolveOpenAiModelsUrl(input.baseUrl);
  const data = await fetchJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });
  return mapOpenAiModels(data);
}

export async function fetchModelsFromProvider(provider: ProviderSummary): Promise<FetchModelsResult> {
  const apiKey = await loadProviderApiKey(provider.id);
  const userAgent = (await loadProviderUserAgent(provider.id)) || provider.userAgent;
  return fetchModelsByCredentials({
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey,
    userAgent,
  });
}

export async function inspectRemoteModel(
  providerId: string,
  modelId: string,
): Promise<ModelCapabilities> {
  const selection = await getSelection();
  void selection;
  return resolveModelCapabilities(modelId);
}

function chatUrl(baseUrl: string, protocol: ProviderProtocol): string {
  const base = normalizeBaseUrl(baseUrl);
  const path = protocol === "anthropic-messages" ? "/messages" : "/chat/completions";
  if (/\/v\d+$/.test(base)) {
    return `${base}${path}`;
  }
  return `${base}/v1${path}`;
}

/** 单次补全：commit 信息等小任务用；走当前选中的供应商与模型 */
export async function completeOnce(
  prompt: string,
  options?: { maxTokens?: number },
): Promise<string> {
  const selection = await getSelection();
  const providerId = selection.providerId;
  const modelId = selection.modelId;
  if (!providerId || !modelId) {
    throw new Error("未配置模型，无法生成");
  }
  const provider = (await listProviders()).find((item) => item.id === providerId);
  if (!provider) {
    throw new Error("未配置模型，无法生成");
  }
  const apiKey = await loadProviderApiKey(provider.id);
  const userAgent =
    sanitizeUserAgent((await loadProviderUserAgent(provider.id)) || provider.userAgent) ||
    DEFAULT_UA;
  const maxTokens = options?.maxTokens ?? 300;

  if (provider.protocol === "anthropic-messages") {
    const data = (await fetchJson(chatUrl(provider.baseUrl, provider.protocol), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "User-Agent": userAgent,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    })) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    return text.trim();
  }

  const data = (await fetchJson(chatUrl(provider.baseUrl, provider.protocol), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": userAgent,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export { normalizeBaseUrl };
