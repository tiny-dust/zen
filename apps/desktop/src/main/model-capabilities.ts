import type { ModelCapabilities } from "@zen/shared";

/** 常见官方模型能力表（手动维护，作为自动填充优先来源） */
const CATALOG: Array<{
  match: RegExp;
  capabilities: ModelCapabilities;
}> = [
  {
    match: /^gpt-5/i,
    capabilities: {
      reasoning: true,
      vision: true,
      toolCall: true,
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      source: "catalog",
    },
  },
  {
    match: /^(o1|o3|o4)/i,
    capabilities: {
      reasoning: true,
      vision: true,
      toolCall: true,
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      source: "catalog",
    },
  },
  {
    match: /^gpt-4\.1/i,
    capabilities: {
      vision: true,
      toolCall: true,
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      source: "catalog",
    },
  },
  {
    match: /^gpt-4o/i,
    capabilities: {
      vision: true,
      toolCall: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: "catalog",
    },
  },
  {
    match: /^claude-(opus-4|4-opus)/i,
    capabilities: {
      reasoning: true,
      vision: true,
      toolCall: true,
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      source: "catalog",
    },
  },
  {
    match: /^claude-(sonnet-4|4-sonnet|3-7-sonnet)/i,
    capabilities: {
      reasoning: true,
      vision: true,
      toolCall: true,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      source: "catalog",
    },
  },
  {
    match: /^claude-(3-5-sonnet|3-5-haiku|3-opus|3-haiku)/i,
    capabilities: {
      vision: true,
      toolCall: true,
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      source: "catalog",
    },
  },
  {
    match: /deepseek-reasoner|deepseek-r1/i,
    capabilities: {
      reasoning: true,
      toolCall: true,
      contextWindow: 128_000,
      maxOutputTokens: 32_768,
      source: "catalog",
    },
  },
  {
    match: /deepseek-chat|deepseek-v3/i,
    capabilities: {
      toolCall: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      source: "catalog",
    },
  },
  {
    match: /gemini-2\.5-pro|gemini-2\.0-flash-thinking/i,
    capabilities: {
      reasoning: true,
      vision: true,
      toolCall: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      source: "catalog",
    },
  },
  {
    match: /gemini-2\.0-flash|gemini-1\.5/i,
    capabilities: {
      vision: true,
      toolCall: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 8_192,
      source: "catalog",
    },
  },
  {
    match: /qwen3|qwq/i,
    capabilities: {
      reasoning: true,
      toolCall: true,
      contextWindow: 131_072,
      maxOutputTokens: 32_768,
      source: "catalog",
    },
  },
  {
    match: /qwen2\.5/i,
    capabilities: {
      toolCall: true,
      contextWindow: 131_072,
      maxOutputTokens: 8_192,
      source: "catalog",
    },
  },
  {
    match: /kimi|moonshot-v1/i,
    capabilities: {
      toolCall: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      source: "catalog",
    },
  },
];

const REASONING_HINT =
  /reason|think|o1|o3|o4|r1|qwq|deepseek-reasoner|gemini.*thinking|claude.*thinking/i;
const VISION_HINT = /vision|4o|4\.1|claude-3|claude-4|gemini|gpt-5/i;
const TOOL_HINT = /gpt|claude|deepseek|qwen|gemini|llama|mistral|kimi|glm/i;

export function inspectModelCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.trim();
  if (!id) {
    return { source: "heuristic" };
  }

  for (const entry of CATALOG) {
    if (entry.match.test(id)) {
      return { ...entry.capabilities };
    }
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
