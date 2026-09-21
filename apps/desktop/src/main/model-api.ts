import { extractChatText, sseDeltaText, stripThinkBlocks } from "./model-api-transform";
import { inspectModelCapabilities, resolveModelCapabilities } from "./model-capabilities";
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

/** 流式补全：onDelta 逐段回调原始增量（可能含思考块）；resolve 为剥掉思考块的完整正文 */
export async function completeOnceStream(
  prompt: string,
  options?: {
    maxTokens?: number;
    system?: string;
    timeoutMs?: number;
    providerId?: string;
    modelId?: string;
  },
  onDelta?: (text: string) => void,
): Promise<string> {
  const { provider, modelId, maxTokens, url, headers } = await resolveCompletion(options);
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const body =
    provider.protocol === "anthropic-messages"
      ? {
          model: modelId,
          max_tokens: maxTokens,
          stream: true,
          ...(options?.system ? { system: options.system } : {}),
          messages: [{ role: "user", content: prompt }],
        }
      : {
          model: modelId,
          max_tokens: maxTokens,
          stream: true,
          messages: options?.system
            ? [
                { role: "system", content: options.system },
                { role: "user", content: prompt },
              ]
            : [{ role: "user", content: prompt }],
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `请求超时（${Math.round(timeoutMs / 1000)} 秒）：模型未开始响应或网络异常，请稍后重试`,
        );
      }
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(httpErrorMessage(response.status, text));
    }
    if (!response.body) {
      throw new Error("供应商未返回流式响应体");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    // SSE 事件以空行分隔；同时兼容 \n 与 \r\n（跨 chunk 拆开的行尾也能正确切分）
    const eventBoundary = /\r?\n\r?\n/;
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let boundary = eventBoundary.exec(buffer);
      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const delta = sseDeltaText(rawEvent);
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
        boundary = eventBoundary.exec(buffer);
      }
    }

    const text = stripThinkBlocks(full);
    if (!text) {
      throw new Error("模型未返回文本内容");
    }
    return text;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `请求超时（${Math.round(timeoutMs / 1000)} 秒）：模型响应中断或网络异常，请稍后重试`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { normalizeBaseUrl };
