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

/** 剥离 reasoning 模型内联在正文里的思考块：<think>…</think>，以及未闭合的前导 <think>… */
function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*<think>[\s\S]*$/i, "")
    .trim();
}

/** 从多种 chat/completions 响应形态里抽出最终文本（思考内容不算正文） */
function extractChatText(data: unknown): string {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: string;
        reasoning?: string;
        text?: string;
      };
      text?: string;
    }>;
    output_text?: string;
  };

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return stripThinkBlocks(payload.output_text);
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (!message) {
    return typeof choice?.text === "string" ? stripThinkBlocks(choice.text) : "";
  }

  // content 可能是 string，或 OpenAI 多模态数组 [{type:'text', text:'...'}]；内联 <think> 时剥离后为空则走兜底
  if (typeof message.content === "string") {
    const stripped = stripThinkBlocks(message.content);
    if (stripped) {
      return stripped;
    }
  }
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const p = part as { type?: string; text?: string };
        return p?.type === "text" || typeof p?.text === "string" ? (p.text ?? "") : "";
      })
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return stripThinkBlocks(message.text);
  }

  // 部分 reasoning 模型 content 为空时，正文可能落在 reasoning_content
  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string") {
    const stripped = stripThinkBlocks(reasoning);
    if (stripped) {
      return stripped;
    }
  }
  return "";
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
  // reasoning 模型会先耗大量 token 思考；预算太小会导致 content 为空、只剩思考内容
  const caps = inspectModelCapabilities(modelId);
  const maxTokens = options?.maxTokens ?? (caps.reasoning ? 2048 : 512);

  if (provider.protocol === "anthropic-messages") {
    const data = await fetchJson(chatUrl(provider.baseUrl, provider.protocol), {
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
    });
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

  const data = await fetchJson(chatUrl(provider.baseUrl, provider.protocol), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": userAgent,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const text = extractChatText(data);
  if (!text) {
    throw new Error("模型未返回文本内容");
  }
  return text;
}

export { normalizeBaseUrl };
