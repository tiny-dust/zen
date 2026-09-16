import { enumOf } from "../utils/enum";

export type ProviderProtocol = "openai-chat" | "openai-responses" | "anthropic-messages";

export const ProviderProtocolEnum = enumOf({
  OpenAiChat: { value: "openai-chat" as ProviderProtocol, label: "OpenAI Chat Completions" },
  OpenAiResponses: {
    value: "openai-responses" as ProviderProtocol,
    label: "OpenAI Responses",
  },
  AnthropicMessages: {
    value: "anthropic-messages" as ProviderProtocol,
    label: "Anthropic Messages",
  },
});

export const PROVIDER_PROTOCOLS = ProviderProtocolEnum.options().map((item) => ({
  id: item.value as ProviderProtocol,
  label: item.label as string,
}));

export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const ReasoningEffortEnum = enumOf({
  Off: { value: "off" as ReasoningEffort, label: "关闭" },
  Minimal: { value: "minimal" as ReasoningEffort, label: "极低" },
  Low: { value: "low" as ReasoningEffort, label: "低" },
  Medium: { value: "medium" as ReasoningEffort, label: "中" },
  High: { value: "high" as ReasoningEffort, label: "高" },
  XHigh: { value: "xhigh" as ReasoningEffort, label: "极高" },
  Max: { value: "max" as ReasoningEffort, label: "最高" },
});

export const REASONING_EFFORTS = ReasoningEffortEnum.options().map((item) => ({
  id: item.value as ReasoningEffort,
  label: item.label as string,
}));

/** 模型级对话端点；auto 表示跟随供应商协议 */
export type ModelChatEndpoint = "auto" | ProviderProtocol;

export const MODEL_CHAT_ENDPOINTS: Array<{ id: ModelChatEndpoint; label: string }> = [
  { id: "auto", label: "自动" },
  ...PROVIDER_PROTOCOLS.map((item) => ({ id: item.id as ModelChatEndpoint, label: item.label })),
];

export type CapabilitySource = "catalog" | "api" | "heuristic" | "manual";

export const CapabilitySourceEnum = enumOf({
  Catalog: { value: "catalog" as CapabilitySource, label: "目录" },
  Api: { value: "api" as CapabilitySource, label: "接口" },
  Heuristic: { value: "heuristic" as CapabilitySource, label: "启发式" },
  Manual: { value: "manual" as CapabilitySource, label: "手动" },
});

export interface ModelCapabilities {
  reasoning?: boolean;
  vision?: boolean;
  toolCall?: boolean;
  media?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 模型支持的推理强度档位；为空表示不限制 */
  reasoningEfforts?: ReasoningEffort[];
  /** 对话端点覆盖；空/未设为 auto */
  chatEndpoint?: ModelChatEndpoint;
  source?: CapabilitySource;
}

export interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
  /** 是否用户手动/自定义添加（相对拉取或目录匹配） */
  custom?: boolean;
  capabilities?: ModelCapabilities;
}

/** 预览拉取模型列表的连接信息（不落库）；providerId 存在时 apiKey 可留空沿用已存 Key */
export interface PreviewModelsInput {
  providerId?: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
}

/** UI-facing provider：apiKey 不回传明文，仅 hasApiKey / apiKeyMask */
export interface ProviderSummary {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  userAgent?: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMask: string;
  models: ProviderModel[];
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
  enabled?: boolean;
  /** 新增时随供应商一并写入的模型 */
  models?: Array<{
    id: string;
    name?: string;
    enabled?: boolean;
    custom?: boolean;
    capabilities?: ModelCapabilities;
  }>;
}

export interface ModelSelection {
  providerId: string | null;
  modelId: string | null;
}

export interface AddModelInput {
  providerId: string;
  id: string;
  name?: string;
  enabled?: boolean;
  custom?: boolean;
  /** 可选：手动覆盖能力 */
  capabilities?: ModelCapabilities;
}

export interface UpdateModelInput {
  providerId: string;
  id: string;
  name?: string;
  enabled?: boolean;
  capabilities?: ModelCapabilities;
}

export interface SetModelsEnabledInput {
  providerId: string;
  modelIds: string[];
  enabled: boolean;
}

export interface CatalogVendor {
  id: string;
  label: string;
  logo?: string;
}

export interface CatalogModel {
  vendor: string;
  vendorLabel: string;
  /** 目录内唯一键，用于匹配（通常为规范 model id） */
  modelKey: string;
  id: string;
  name: string;
  capabilities: ModelCapabilities;
}

export interface CatalogMatch {
  /** 命中的目录模型；未命中为空 */
  model: CatalogModel | null;
  /** 输入 ID 拆分后的候选 key */
  candidates: string[];
}

export interface FetchModelsResult {
  models: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    capabilities?: ModelCapabilities;
  }>;
  fetchedAt: number;
}
