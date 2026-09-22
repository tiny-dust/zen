import { extractChatText } from "./model-api-transform";
import { inspectModelCapabilities, mergeApiModelCapabilities, resolveModelCapabilities } from "./model-capabilities";
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

/** 补全类小任务（commit message 等）的超时：reasoning 模型响应慢，默认 20s 会偶发中断 */
const COMPLETION_TIMEOUT_MS = 60_000;
/** reasoning 模型的最小补全预算：思考会先消耗 token，预算太小会只输出思考内容 */
const REASONING_MIN_TOKENS = 4096;

/** 从 HTTP 错误响应体里取供应商给的错误消息，取不到退回状态码 */
function httpErrorMessage(status: number, bodyText: string): string {
  let data: unknown = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = { raw: bodyText };
  }
  const record = data as { error?: { message?: string } | string; message?: string } | null;
  if (typeof record?.error === "string") {
    return record.error;
  }
  return record?.error?.message ?? record?.message ?? `HTTP ${status}`;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `请求超时（${Math.round(timeoutMs / 1000)} 秒）：服务未响应或网络异常，请稍后重试`,
        );
      }
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
      throw new Error(httpErrorMessage(response.status, text));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** 条目 ID 字段别名：id 为主，部分兼容实现用 model / model_id / name */
function pickModelId(item: Record<string, unknown>): string {
  return firstString(item, ["id", "model", "model_id", "name"]);
}

/** 展示名别名：display_name / name / model_name */
function pickModelName(item: Record<string, unknown>): string {
  return firstString(item, ["display_name", "name", "model_name"]);
}

function mapOpenAiModels(data: unknown): FetchModelsResult {
  const payload = data as { data?: Array<Record<string, unknown>> };
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const models = list
    .map((item) => {
      const id = pickModelId(item);
      if (!id) {
        return null;
      }
      return {
        id,
        name: pickModelName(item) || id,
        capabilities: mergeApiModelCapabilities(id, item),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return { models, fetchedAt: Date.now() };
}

function mapAnthropicModels(data: unknown): FetchModelsResult {
  const payload = data as { data?: Array<Record<string, unknown>> };
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const models = list
    .map((item) => {
      const id = pickModelId(item);
      if (!id) {
        return null;
      }
      return {
        id,
        name: pickModelName(item) || id,
        capabilities: mergeApiModelCapabilities(id, item),
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

/** 补全请求的公共准备：解析供应商/模型、密钥、UA、token 预算与请求头 */
async function resolveCompletion(options?: {
  maxTokens?: number;
  providerId?: string;
  modelId?: string;
}): Promise<{
  provider: ProviderSummary;
  modelId: string;
  maxTokens: number;
  url: string;
  headers: Record<string, string>;
}> {
  const selection = await getSelection();
  const providerId = options?.providerId || selection.providerId;
  const modelId = options?.modelId || selection.modelId;
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
  // reasoning 模型会先耗大量 token 思考；预算太小会导致 content 为空、只剩思考内容
  const caps = inspectModelCapabilities(modelId);
  let maxTokens = options?.maxTokens ?? (caps.reasoning ? 4096 : 512);
  if (caps.reasoning) {
    maxTokens = Math.max(maxTokens, 4096);
  }
  const headers: Record<string, string> =
    provider.protocol === "anthropic-messages"
      ? {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "User-Agent": userAgent,
        }
      : {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": userAgent,
        };
  return { provider, modelId, maxTokens, url: chatUrl(provider.baseUrl, provider.protocol), headers };
}

/** 单次补全：commit 信息等小任务用；走当前选中的供应商与模型 */
export async function completeOnce(
  prompt: string,
  options?: {
    maxTokens?: number;
    system?: string;
    timeoutMs?: number;
    providerId?: string;
    modelId?: string;
  },
): Promise<string> {
  const { provider, modelId, maxTokens, url, headers } = await resolveCompletion(options);
  // 补全（尤其推理模型 stream:false 全量缓冲）远慢于列表类请求，默认放宽到 120s
  const timeoutMs = options?.timeoutMs ?? 120_000;

  if (provider.protocol === "anthropic-messages") {
    const data = await fetchJson(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          ...(options?.system ? { system: options.system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      },
      timeoutMs,
    );
    const payload = data as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" || typeof block?.text === "string")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new Error("模型未返回文本内容");
    }
    return text;
  }

  const data = await fetchJson(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        stream: false,
        messages: options?.system
          ? [
              { role: "system", content: options.system },
              { role: "user", content: prompt },
            ]
          : [{ role: "user", content: prompt }],
      }),
    },
    timeoutMs,
  );
  const text = extractChatText(data);
  if (!text) {
    throw new Error("模型未返回文本内容");
  }
  return text;
}

export { normalizeBaseUrl };

/** 视觉补全的图片输入：base64 裸数据 + MIME（png/jpg/jpeg/webp/gif） */
export interface VisionImage {
  name: string;
  mediaType: string;
  base64: string;
}

/**
 * 单次视觉补全：把图片交给具备视觉能力的模型，返回文字描述。
 * 供「当前模型不支持多模态」时的图片预分析兜底，走指定供应商与模型。
 */
export async function completeVisionOnce(
  images: VisionImage[],
  prompt: string,
  options?: { providerId?: string; modelId?: string; timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  if (!images.length) {
    throw new Error("没有可分析的图片");
  }
  const { provider, modelId, maxTokens, url, headers } = await resolveCompletion({
    maxTokens: options?.maxTokens ?? 1024,
    providerId: options?.providerId,
    modelId: options?.modelId,
  });
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const content =
    provider.protocol === "anthropic-messages"
      ? [
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.base64 },
          })),
          { type: "text", text: prompt },
        ]
      : [
          { type: "text", text: prompt },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          })),
        ];

  const data = await fetchJson(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        messages: [{ role: "user", content }],
      }),
    },
    timeoutMs,
  );

  if (provider.protocol === "anthropic-messages") {
    const payload = data as { content?: Array<{ type?: string; text?: string }> };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" || typeof block?.text === "string")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new Error("模型未返回图片描述");
    }
    return text;
  }

  const text = extractChatText(data);
  if (!text) {
    throw new Error("模型未返回图片描述");
  }
  return text;
}
