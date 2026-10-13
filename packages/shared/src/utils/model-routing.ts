import type { ModelCapabilities } from "../types/model";

/**
 * 模型自动路由（纯函数，渲染层调用，不落主进程）：
 * 按请求特征（消息文本 / 图片附件 / 工具调用 / 上下文长度估算）给候选模型打分排序。
 */

/** 命中的路由规则标识（UI 侧按 i18n 映射为理由文案） */
export type ModelRoutingRuleId =
  | "image-vision"
  | "tools"
  | "reasoning-task"
  | "long-context"
  | "casual-light"
  | "fallback";

/** 候选模型：provider + model id + 能力开关 */
export interface ModelRoutingCandidate {
  providerId: string;
  modelId: string;
  name?: string;
  capabilities?: ModelCapabilities;
}

/** 请求特征：由发送现场（文本 / 附件 / 历史估算）归纳 */
export interface ModelRoutingRequest {
  /** 本次发送的消息文本 */
  text: string;
  /** 是否携带图片附件（必须路由到支持视觉的模型） */
  hasImages?: boolean;
  /** 是否需要工具调用（必须路由到启用工具的模型） */
  needsTools?: boolean;
  /** 估算的本次请求上下文 token（含历史）；超过阈值视为长上下文 */
  estimatedTokens?: number;
}

/** 路由结论：推荐模型 + 命中规则（有序） + 得分 */
export interface ModelRoutingDecision {
  providerId: string;
  modelId: string;
  rules: ModelRoutingRuleId[];
  score: number;
}

/** 重构/调试/架构类关键词：命中后优先推理模型 */
const REASONING_TASK_RE =
  /(重构|调试|排查|架构|根因|优化|性能|修复|压测|定位|分析|review|refactor|debug|architect|profil)/i;

/** 轻量快速模型 id/name 关键词（flash / lite / mini / hemisphere 等） */
const LIGHTWEIGHT_MODEL_RE = /(flash|lite|mini|hemisphere|haiku|nano|instant|turbo|speed|fast)/i;

/** 简短日常问答的正文长度上限（字符） */
const CASUAL_TEXT_MAX_CHARS = 120;

/** 长上下文阈值（估算 token）：超过后优先推理 + 大上下文 */
const LONG_CONTEXT_TOKENS = 60_000;

/** 上下文窗口归一化上限：contextWindow 达到该值记满分 */
const CONTEXT_WINDOW_FULL = 200_000;

function hasCapability(candidate: ModelRoutingCandidate, key: keyof ModelCapabilities): boolean {
  return candidate.capabilities?.[key] === true;
}

/** 硬性过滤：不可满足时回退全量候选并记 fallback 规则 */
function filterOrFallback(
  candidates: ModelRoutingCandidate[],
  predicate: (candidate: ModelRoutingCandidate) => boolean,
  rules: ModelRoutingRuleId[],
): ModelRoutingCandidate[] {
  const matched = candidates.filter(predicate);
  if (matched.length) {
    return matched;
  }
  rules.push("fallback");
  return candidates;
}

/** 单个候选的综合得分（越高越优先；规则命中情况由调用方记录） */
function scoreCandidate(
  candidate: ModelRoutingCandidate,
  features: { reasoningTask: boolean; longContext: boolean; casual: boolean },
): number {
  const { reasoningTask, longContext, casual } = features;
  let score = 0;
  const reasoning = hasCapability(candidate, "reasoning");
  const lightweight =
    LIGHTWEIGHT_MODEL_RE.test(candidate.modelId) ||
    (candidate.name ? LIGHTWEIGHT_MODEL_RE.test(candidate.name) : false);

  if (reasoningTask || longContext) {
    if (reasoning) {
      score += 40;
    }
    if (longContext) {
      const window = candidate.capabilities?.contextWindow ?? 0;
      score += (Math.min(window, CONTEXT_WINDOW_FULL) / CONTEXT_WINDOW_FULL) * 25;
    }
  }
  if (casual) {
    if (lightweight) {
      score += 30;
    }
    if (!reasoning) {
      score += 10;
    } else {
      score -= 20;
    }
  }
  return score;
}

/**
 * 路由入口：返回推荐模型与命中规则；无候选时返回 null。
 * 打分并列时保持候选列表原顺序（前端传入顺序即展示顺序），保证结果稳定可测。
 */
export function routeModel(
  candidates: ModelRoutingCandidate[],
  request: ModelRoutingRequest,
): ModelRoutingDecision | null {
  if (!candidates.length) {
    return null;
  }

  const rules: ModelRoutingRuleId[] = [];
  let pool = candidates;

  // 硬性需求：带图片必须视觉；需要工具必须启用 toolCall（无满足者回退全量并记 fallback）
  if (request.hasImages) {
    rules.push("image-vision");
    pool = filterOrFallback(pool, (item) => hasCapability(item, "vision"), rules);
  }
  if (request.needsTools) {
    rules.push("tools");
    pool = filterOrFallback(pool, (item) => hasCapability(item, "toolCall"), rules);
  }

  const text = request.text ?? "";
  const reasoningTask = REASONING_TASK_RE.test(text);
  const longContext = (request.estimatedTokens ?? 0) >= LONG_CONTEXT_TOKENS;
  const casual =
    !reasoningTask && !longContext && text.trim().length > 0 && text.trim().length <= CASUAL_TEXT_MAX_CHARS;

  if (reasoningTask) {
    rules.push("reasoning-task");
  }
  if (longContext) {
    rules.push("long-context");
  }
  if (casual) {
    rules.push("casual-light");
  }
  // 无任何特征规则命中（也没有硬性回退）时记 fallback，UI 提示按默认顺序选择
  if (!rules.includes("fallback") && !reasoningTask && !longContext && !casual) {
    rules.push("fallback");
  }

  const features = { reasoningTask, longContext, casual };
  let best: { candidate: ModelRoutingCandidate; score: number } | null = null;
  for (const candidate of pool) {
    const score = scoreCandidate(candidate, features);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }
  if (!best) {
    return null;
  }
  return {
    providerId: best.candidate.providerId,
    modelId: best.candidate.modelId,
    rules,
    score: best.score,
  };
}
