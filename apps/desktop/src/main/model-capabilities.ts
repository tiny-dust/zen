import type { ModelCapabilities } from "@zen/shared";

import { matchCatalogModel } from "./model-catalog";

const REASONING_HINT =
  /reason|think|o1|o3|o4|r1|qwq|deepseek-reasoner|gemini.*thinking|claude.*thinking/i;
const VISION_HINT = /vision|4o|4\.1|claude-3|claude-4|gemini|gpt-5/i;
const TOOL_HINT = /gpt|claude|deepseek|qwen|gemini|llama|mistral|kimi|glm/i;

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
