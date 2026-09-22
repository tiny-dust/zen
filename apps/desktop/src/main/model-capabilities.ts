import type { ModelCapabilities } from "@zen/shared";

import { matchCatalogModel } from "./model-catalog";

const REASONING_HINT =
  /reason|think|o1|o3|o4|r1|qwq|deepseek-reasoner|gemini.*thinking|claude.*thinking/i;
const VISION_HINT = /vision|4o|4\.1|claude-3|claude-4|gemini|gpt-5/i;
const TOOL_HINT = /gpt|claude|deepseek|qwen|gemini|llama|mistral|kimi|glm/i;

/** 各家 /v1/models 条目里表示上下文长度的字段别名，按优先级排列（max_tokens 语义最含糊，放最后） */
const CONTEXT_KEYS = [
  "context_length",
  "max_context_length",
  "context_size",
  "context_window",
  "context",
  "max_model_len",
  "max_input_tokens",
  "max_prompt_length",
  "max_tokens",
];
/** 最大输出 token 的字段别名 */
const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "max_response_tokens", "max_output"];
/** 能力信息可能出现的字段别名（数组或布尔映射） */
const CAPABILITY_SOURCES = [
  "supported_parameters",
  "capabilities",
  "input_modalities",
  "supports",
  "modalities",
];

const TOOL_TOKENS = /^(tools?|tool_calls?|tool_choice|parallel_tool_calls?|function_call|function_calling|functions?)$/i;
const REASONING_TOKENS = /^(reasoning|reasoning_efforts?|thinking|extended_thinking|thoughts?)$/i;
const VISION_TOKENS = /^(vision|image|images|image_input|visual)$/i;
const MEDIA_TOKENS = /^(media|audio|video)$/i;

type CapabilityFlagKey = "reasoning" | "vision" | "toolCall" | "media";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPositiveInt(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  return typeof num === "number" && Number.isFinite(num) && num > 0 ? Math.round(num) : undefined;
}

function pickPositiveInt(record: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const found = asPositiveInt(record[key]);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function flagKeyOf(token: string): CapabilityFlagKey | null {
  if (TOOL_TOKENS.test(token)) {
    return "toolCall";
  }
  if (REASONING_TOKENS.test(token)) {
    return "reasoning";
  }
  if (VISION_TOKENS.test(token)) {
    return "vision";
  }
  if (MEDIA_TOKENS.test(token)) {
    return "media";
  }
  return null;
}

/**
 * 解析 /v1/models 条目里的真实能力元数据。
 * 字段各家不一（supported_parameters / capabilities / input_modalities / supports 等），
 * 数组/字符串只作“支持”的正向证据，显式布尔值（含 false）优先；解析不到的字段不返回，交给调用方回退。
 */
export function parseApiModelCapabilities(raw: unknown): ModelCapabilities {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const capabilities: ModelCapabilities = {};

  const contextWindow = pickPositiveInt(record, CONTEXT_KEYS);
  if (contextWindow !== undefined) {
    capabilities.contextWindow = contextWindow;
  }
  const maxOutputTokens =
    pickPositiveInt(record, OUTPUT_KEYS) ??
    pickPositiveInt(asRecord(record.top_provider), ["max_completion_tokens", "max_output_tokens"]);
  if (maxOutputTokens !== undefined) {
    capabilities.maxOutputTokens = maxOutputTokens;
  }

  const positive: Partial<Record<CapabilityFlagKey, boolean>> = {};
  const explicit: Partial<Record<CapabilityFlagKey, boolean>> = {};
  const markPositive = (token: string) => {
    const key = flagKeyOf(token.trim().toLowerCase());
    if (key) {
      positive[key] = true;
    }
  };
  const markExplicit = (token: string, value: boolean) => {
    const key = flagKeyOf(token.trim().toLowerCase());
    if (key) {
      explicit[key] = value;
    }
  };

  for (const sourceKey of CAPABILITY_SOURCES) {
    const source = record[sourceKey];
    if (Array.isArray(source)) {
      for (const element of source) {
        if (typeof element === "string") {
          markPositive(element);
        }
      }
      continue;
    }
    const sourceRecord = asRecord(source);
    if (!sourceRecord) {
      continue;
    }
    for (const [key, value] of Object.entries(sourceRecord)) {
      if (typeof value === "boolean") {
        markExplicit(key, value);
      } else if (typeof value === "string") {
        markPositive(value);
      } else if (Array.isArray(value)) {
        for (const element of value) {
          if (typeof element === "string") {
            markPositive(element);
          }
        }
      }
    }
  }

  for (const key of ["reasoning", "vision", "toolCall", "media"] as const) {
    const value = explicit[key] ?? positive[key];
    if (value !== undefined) {
      capabilities[key] = value;
    }
  }

  return capabilities;
}

/** API 真实元数据优先，缺省字段回退 resolveModelCapabilities（目录/启发式） */
export function mergeApiModelCapabilities(modelId: string, raw: unknown): ModelCapabilities {
  const apiCapabilities = parseApiModelCapabilities(raw);
  const fallback = resolveModelCapabilities(modelId);
  if (!Object.keys(apiCapabilities).length) {
    return fallback;
  }
  return { ...fallback, ...apiCapabilities, source: "api" };
}

/** 目录命中优先；未命中再用 ID 启发式推断 */
export function inspectModelCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.trim();
  if (!id) {
    return { source: "heuristic" };
  }

  const catalogHit = matchCatalogModel(id);
  if (catalogHit.model) {
    return { ...catalogHit.model.capabilities, source: "catalog" };
  }

  const lower = id.toLowerCase();
  const capabilities: ModelCapabilities = {
    reasoning: REASONING_HINT.test(lower) || undefined,
    vision: VISION_HINT.test(lower) || undefined,
    toolCall: TOOL_HINT.test(lower) || undefined,
    source: "heuristic",
  };

  if (/128k|128000/.test(lower)) {
    capabilities.contextWindow = 128_000;
  } else if (/200k|200000/.test(lower)) {
    capabilities.contextWindow = 200_000;
  } else if (/32k|32000/.test(lower)) {
    capabilities.contextWindow = 32_000;
  } else if (/1m|1000000|1048576/.test(lower)) {
    capabilities.contextWindow = 1_000_000;
  }

  return capabilities;
}

/** 手动覆盖优先，其次目录/启发式 */
export function resolveModelCapabilities(
  modelId: string,
  inputCapabilities?: ModelCapabilities,
): ModelCapabilities {
  if (inputCapabilities) {
    return { ...inputCapabilities };
  }
  return inspectModelCapabilities(modelId);
}

export function prettyModelName(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "未命名模型";
  }
  return trimmed
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
