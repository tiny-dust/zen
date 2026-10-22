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

/**
 * 仅支持 adaptive 思考的新一代 Claude（fable / opus-5 / sonnet-5 / 4.6+）。
 * 这些模型拒绝 thinking: {type:"enabled"}，只认 thinking adaptive + output_config.effort。
 * 对齐 @ai-sdk/anthropic getModelCapabilities 的支持表；未知新 Claude（目录未收录）
 * 按 SDK 惯例同样视为 adaptive。
 */
const ADAPTIVE_CLAUDE = /claude-(?:fable|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6)/i;
/** 旧 Claude（enabled/budget_tokens 时代）；sonnet-4/opus-4 用边界断言避免误伤 4-5/4-6 */
const LEGACY_CLAUDE =
  /claude-(?:haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|sonnet-4(?:-|@|$)|opus-4(?:-|@|$)|3|instant|v?2(?:$|[-.:]))/i;
/** adaptive 但不支持 xhigh effort 档的模型（SDK 支持表：仅 fable/opus-4-7+/sonnet-5/opus-5 支持） */
const NO_XHIGH_EFFORT_CLAUDE = /claude-(?:sonnet-4-6|opus-4-6)/i;

export function supportsAdaptiveThinking(modelId: string): boolean {
  if (ADAPTIVE_CLAUDE.test(modelId)) {
    return true;
  }
  // 目录未收录的 claude-* 视为更新的型号（与 SDK 的兜底分支一致）
  return /claude-/i.test(modelId) && !LEGACY_CLAUDE.test(modelId);
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
    // prompt 缓存断点（system 块）：anthropic 顶层 providerOptions 的 cacheControl
    // 会被 provider 映射到 system 文本块；instructions 字节级稳定时 tools+system
    // 整段前缀可命中（ephemeral 断点滚动续期，步间请求间隔内有效）
    const cache = { cacheControl: { type: "ephemeral" as const } };
    // 旧 Claude（haiku-4-5 / sonnet-4-5 / 4-1 / 4 / 3 系）只认 enabled/budget_tokens，
    // 对它们下发 adaptive 会收到对称的 400；不下发 thinking，交给服务端默认（旧模型默认关闭）。
    // 非推理模型（capabilities.reasoning=false）同样不下发。
    if (!supportsAdaptiveThinking(config.model) || !config.reasoning) {
      return { anthropic: cache };
    }
    // display: summarized —— Opus 4.7+ / Fable 默认省略思考正文，不显式要回则 UI 看不到推理过程
    if (!effort || effort === "off") {
      // 未选档位（off 仅作缺省值出现）：adaptive 思考交给服务端默认强度
      return { anthropic: { thinking: { type: "adaptive", display: "summarized" }, ...cache } };
    }
    // anthropic 不接受 "minimal" 映射到 "low"；sonnet-4-6/opus-4-6 不支持 "xhigh" 映射到 "max"
    const mapped = effort === "minimal" ? "low" : effort;
    const capped = mapped === "xhigh" && NO_XHIGH_EFFORT_CLAUDE.test(config.model) ? "max" : mapped;
    return {
      anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: capped, ...cache },
    };
  }

  if (config.protocol === "openai-responses") {
    // prompt_cache_key = 会话 id：同会话请求路由到同一缓存节点（前缀缓存亲和）。
    // 子会话 sessionId 带 :: 后缀，天然与父会话隔离（对齐 Codex 的 SessionDerived 策略）
    const options: Record<string, unknown> = { promptCacheKey: config.sessionId };
    if (effort && effort !== "off") {
      options.reasoningEffort = effort;
    }
    return { openai: options };
  }
  if (!effort || effort === "off") {
    return {};
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
 * 第 3 层带上会话的 providerOptions（推理档位一致，GPT-6 等推理模型不传档位会用默认档
 * 高速空转）、透传 abortSignal（用户取消立即中断）且 maxRetries=0（修复失败交回 SDK
 * 默认回喂，不叠加慢请求重试）。任何异常都吞掉返回 null——修复器自身绝不能把 run 打挂。
 */
export function buildToolCallRepair(
  model: LanguageModel,
  providerOptions?: Record<string, unknown>,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, inputSchema, error, abortSignal }) => {
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
        providerOptions: providerOptions as never,
        abortSignal,
        maxRetries: 0,
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
