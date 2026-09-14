export type ProviderProtocol =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages";

export const PROVIDER_PROTOCOLS: Array<{ id: ProviderProtocol; label: string }> = [
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
];

export interface ModelCapabilities {
  reasoning?: boolean;
  vision?: boolean;
  toolCall?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  source?: "catalog" | "api" | "heuristic";
}

export interface ProviderModel {
  id: string;
  name: string;
  capabilities?: ModelCapabilities;
}

/** UI-facing provider：apiKey 不回传明文，仅 hasApiKey / apiKeyMask */
export interface ProviderSummary {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
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
}

export interface ModelSelection {
  providerId: string | null;
  modelId: string | null;
}

export interface AddModelInput {
  providerId: string;
  id: string;
  name?: string;
  /** 可选：手动覆盖能力 */
  capabilities?: ModelCapabilities;
}

export interface FetchModelsResult {
  models: Array<{ id: string; name: string; capabilities?: ModelCapabilities }>;
  fetchedAt: number;
}
