import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { LanguageModel } from "ai";

import type { AgentSessionConfig } from "./agent-config";

function withVersionSegment(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/v\d+$/.test(base)) {
    return base;
  }
  return `${base}/v1`;
}

export function createLanguageModel(config: AgentSessionConfig): LanguageModel {
  const baseURL = withVersionSegment(config.baseUrl);

  if (config.protocol === "anthropic-messages") {
    const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL });
    return anthropic(config.model);
  }

  if (config.protocol === "openai-responses") {
    const openai = createOpenAI({ apiKey: config.apiKey, baseURL });
    return openai.responses(config.model);
  }

  const compatible = createOpenAICompatible({
    name: "zen-provider",
    apiKey: config.apiKey,
    baseURL,
  });
  return compatible.chatModel(config.model);
}

export function buildProviderOptions(config: AgentSessionConfig): Record<string, unknown> {
  const effort = config.reasoningEffort;

  if (config.protocol === "anthropic-messages") {
    // 最新 Claude 模型只接受 adaptive 思考（enabled/budget_tokens 已废弃）。
    // 推理模型显式传 adaptive + effort，避免 AI SDK 对目录未收录模型回退到 enabled 形态报错。
    if (config.reasoning) {
      const raw = effort && effort !== "off" ? effort : "medium";
      // anthropic 不接受 "minimal"，映射到 "low"
      const mapped = raw === "minimal" ? "low" : raw;
      return { anthropic: { thinking: { type: "adaptive" }, effort: mapped } };
    }
    if (effort && effort !== "off") {
      return { anthropic: { thinking: { type: "adaptive" }, effort: effort === "minimal" ? "low" : effort } };
    }
    return {};
  }

  if (!effort || effort === "off") {
    return {};
  }
  if (config.protocol === "openai-responses") {
    return { openai: { reasoningEffort: effort } };
  }
  return { zenProvider: { reasoningEffort: effort } };
}

export function truncateOutput(text: string, limit = 8000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…[输出截断]` : text;
}
