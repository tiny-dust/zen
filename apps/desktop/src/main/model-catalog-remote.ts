import { CATALOG_VENDORS } from "./model-catalog-data";

import type { CatalogModel, ModelCapabilities } from "@zen/shared";

/** models.dev 公开目录（https://models.dev/api.json），社区维护、实时反映上下文/能力/下架状态 */
const MODELS_DEV_API = "https://models.dev/api.json";

/** models.dev 提供商 id → zen 内置厂商 id；未映射的提供商不进目录 */
const PROVIDER_MAP: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  alibaba: "qwen",
  zai: "zhipu",
  moonshotai: "moonshot",
  mistral: "mistral",
  meta: "meta",
  llama: "meta",
  xai: "xai",
  xiaomi: "mimo",
};

const VENDOR_LABEL = new Map(CATALOG_VENDORS.map((item) => [item.id, item.label]));

interface RemoteModel {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  reasoning?: unknown;
  tool_call?: unknown;
  modalities?: { input?: unknown; output?: unknown };
  limit?: { context?: unknown; output?: unknown };
}

interface RemoteProvider {
  id?: unknown;
  name?: unknown;
  models?: Record<string, RemoteModel>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asPositiveInt(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? Math.round(num) : undefined;
}

function mapCapabilities(model: RemoteModel): ModelCapabilities {
  const capabilities: ModelCapabilities = { source: "catalog" };
  const input = asStringArray(model.modalities?.input).map((item) => item.toLowerCase());
  const output = asStringArray(model.modalities?.output).map((item) => item.toLowerCase());
  const context = asPositiveInt(model.limit?.context);
  const maxOutput = asPositiveInt(model.limit?.output);

  if (model.reasoning === true) {
    capabilities.reasoning = true;
  }
  if (model.tool_call === true) {
    capabilities.toolCall = true;
  }
  if (input.includes("image")) {
    capabilities.vision = true;
  }
  if (input.includes("audio") || input.includes("video")) {
    capabilities.media = true;
  }
  if (context !== undefined) {
    capabilities.contextWindow = context;
  }
  if (maxOutput !== undefined) {
    capabilities.maxOutputTokens = maxOutput;
  }
  return capabilities;
}

/** models.dev 条目 → zen 目录模型；非对话模型（嵌入/生图/语音）返回 null */
function mapRemoteModel(vendorId: string, model: RemoteModel): CatalogModel | null {
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id) {
    return null;
  }
  // 只保留对话模型：文本进、文本出；过滤嵌入/生图/语音等会造成误配置的条目
  const input = asStringArray(model.modalities?.input).map((item) => item.toLowerCase());
  const output = asStringArray(model.modalities?.output).map((item) => item.toLowerCase());
  if (!input.includes("text") || !output.includes("text")) {
    return null;
  }
  // 已下架（deprecated）不进目录
  if (model.status === "deprecated") {
    return null;
  }
  const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
  return {
    vendor: vendorId,
    vendorLabel: VENDOR_LABEL.get(vendorId) ?? vendorId,
    modelKey: id,
    id,
    name,
    capabilities: mapCapabilities(model),
  };
}

/**
 * 把 models.dev 响应映射为 zen 目录模型。
 * 仅收录内置厂商（避免上百个聚合提供商淹没列表），同键去重时优先保留先出现且未标记 beta 的条目。
 */
export function mapRemoteCatalog(data: unknown): CatalogModel[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [];
  }
  const result = new Map<string, CatalogModel>();
  for (const [providerId, rawProvider] of Object.entries(data as Record<string, unknown>)) {
    const vendorId = PROVIDER_MAP[providerId];
    if (!vendorId) {
      continue;
    }
    const provider = rawProvider as RemoteProvider;
    for (const model of Object.values(provider.models ?? {})) {
      const mapped = mapRemoteModel(vendorId, model);
      if (!mapped) {
        continue;
      }
      const key = `${mapped.vendor}/${mapped.modelKey}`;
      const existing = result.get(key);
      if (!existing || (existing.capabilities.reasoning === undefined && mapped.capabilities.reasoning)) {
        result.set(key, mapped);
      }
    }
  }
  return [...result.values()];
}

export interface RemoteCatalogFetchResult {
  models: CatalogModel[];
  fetchedAt: number;
}

/** 拉取并映射 models.dev 实时目录；网络失败/超时抛错，由调用方决定是否保留旧目录 */
export async function fetchRemoteCatalogModels(timeoutMs = 20_000): Promise<RemoteCatalogFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(MODELS_DEV_API, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error && error.name === "AbortError" ? "请求超时" : "网络异常";
    throw new Error(`模型目录更新失败（${message}），请稍后重试`);
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`模型目录更新失败（HTTP ${response.status}），请稍后重试`);
  }
  const data = (await response.json()) as unknown;
  const models = mapRemoteCatalog(data);
  if (!models.length) {
    throw new Error("模型目录更新失败：数据源返回为空，已保留当前目录");
  }
  return { models, fetchedAt: Date.now() };
}
