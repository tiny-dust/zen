import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  InvalidToolInputError,
  jsonSchema,
  NoSuchToolError,
  Output,
} from "ai";

import type { LanguageModel, ToolCallRepairFunction, ToolSet } from "ai";

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

/** 工具名归一化 key：忽略大小写与分隔符（GPT 系常把 runTerminal 写成 run_terminal） */
function toolNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * NoSuchToolError 的确定性修复：工具名被写成 snake/kebab/大小写变形时改回真实工具名。
 * 归一化后唯一命中才修复；命中不了返回 null，让错误按原路回喂模型自行纠正。
 */
export function normalizeToolName(toolName: string, tools: ToolSet): string | null {
  const target = toolNameKey(toolName);
  if (!target) {
    return null;
  }
  const hits = Object.keys(tools).filter((name) => toolNameKey(name) === target);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * 工具入参文本清理：剥 markdown 代码围栏、去掉 JSON 前后的说明文字、删尾逗号。
 * 对应 GPT 系模型三种常见畸形 JSON；清理结果是否可用由调用方解析 + schema 校验决定。
 */
export function cleanToolInputText(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  const fenceBody = fence?.[1];
  if (fenceBody !== undefined) {
    text = fenceBody.trim();
  }
  if (text && !/^[[{]/.test(text)) {
    const start = text.search(/[[{]/);
    const openChar = start >= 0 ? text[start] : undefined;
    if (openChar === "{" || openChar === "[") {
      const close = openChar === "{" ? "}" : "]";
      const end = text.lastIndexOf(close);
      if (end > start) {
        text = text.slice(start, end + 1).trim();
      }
    }
  }
  return text.replace(/,\s*([}\]])/g, "$1");
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** 结构化输出/本地校验只在拿到 zod 形态（带 safeParse）的 schema 时启用 */
function zodSafeParseOf(
  schema: unknown,
): ((value: unknown) => { success: boolean }) | null {
  const holder = schema as { safeParse?: (value: unknown) => { success: boolean } } | null;
  return typeof holder?.safeParse === "function" ? holder.safeParse : null;
}

/**
 * 工具调用修复（AI SDK `repairToolCall`）：GPT 系模型常产出工具名变形、入参畸形 JSON
 * 或不合 schema 的工具调用；不修复会以 tool-error 回喂，UI 大量报错且多一轮往返。
 * 按成本分三层，任一层成功即返回；全部失败返回 null，走 SDK 默认路径把错误回喂模型：
 * 1. 工具名归一化（NoSuchToolError，零成本）；
 * 2. 入参文本清理 + 本地 schema 校验（零成本）；
 * 3. 同模型结构化输出重写入参（schema 约束；返回后仍经 SDK doParse 复验，失败即安全降级）。
 * 任何异常都吞掉返回 null——修复器自身绝不能把 run 打挂。
 */
export function buildToolCallRepair(model: LanguageModel): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, inputSchema, error }) => {
    try {
      if (NoSuchToolError.isInstance(error)) {
        // error.toolName 是查找失败的权威名字：归一化它而非 toolCall 上的名字，
        // 归一化后仍不唯一命中就交回 SDK 默认路径（错误回喂模型自行纠正），不瞎猜
        const name = normalizeToolName(error.toolName, tools);
        return name ? { ...toolCall, toolName: name } : null;
      }
      if (!InvalidToolInputError.isInstance(error)) {
        return null;
      }
      const tool = tools[toolCall.toolName];
      if (tool == null) {
        return null;
      }
      const raw =
        typeof toolCall.input === "string" ? toolCall.input : JSON.stringify(toolCall.input);
      const holder = tool.inputSchema;
      const localValidate = zodSafeParseOf(holder);
      // 2. 清理 + 本地校验：通过即确定性修复
      const cleaned = cleanToolInputText(raw);
      const parsed = tryParseJson(cleaned);
      if (parsed.ok && localValidate && localValidate(parsed.value).success) {
        return { ...toolCall, input: JSON.stringify(parsed.value) };
      }
      // 3. 模型结构化重写：json_object 模式要求提示词里出现 "JSON" 字样
      const declared = await inputSchema({ toolName: toolCall.toolName });
      const schema = localValidate ? holder : jsonSchema(declared);
      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        prompt: [
          `The model tried to call the tool "${toolCall.toolName}" but the inputs failed validation.`,
          `Original input:`,
          raw,
          `Tool input JSON schema:`,
          JSON.stringify(declared),
          `Return ONLY a fixed JSON object that matches the schema, keeping the original intent`,
          `(the same command/path/values the model meant to send). No explanation, JSON only.`,
        ].join("\n"),
      });
      return { ...toolCall, input: JSON.stringify(output) };
    } catch {
      return null;
    }
  };
}
