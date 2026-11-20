import type {
  AgentRunRequest,
  PermissionMode,
  PhaseModelRef,
  SessionGoal,
  SessionMode,
  SessionRecord,
} from "@zen/shared";
import {
  normalizeSessionMode,
  PERMISSION_MODE_LABELS,
  PLAN_APPROVAL_MESSAGE,
} from "@zen/shared";

/**
 * 会话模式（interactive/plan/autopilot）的主进程侧逻辑：
 * - 计划模式批准识别（approvePlan 标志或「批准执行」开头的手打消息）；
 * - 按模式生成追加进系统提示词的指令文本（interactive 不追加，保持现状）。
 * 只做提示层引导：autopilot 不绕过权限系统，工具审批仍由 permissionMode 统一管控。
 */

/** 判定一次 run 请求是否是对计划的批准 */
export function isPlanApproval(
  message: string,
  approvePlan?: boolean,
): boolean {
  if (approvePlan === true) {
    return true;
  }
  // 手打「批准执行」（可带补充说明，如「批准执行，但先改一下 X」）同样视为批准
  return message.trim().startsWith(PLAN_APPROVAL_MESSAGE);
}

/**
 * run 前解析本次生效的会话模式：
 * plan 模式下的批准消息 → 先经 persist 落库切回 interactive，本次按 interactive 跑；
 * 其余情况沿用会话当前模式（未知值归一化为 interactive）。
 */
export function resolveRunSessionMode(
  mode: unknown,
  request: Pick<AgentRunRequest, "userMessage" | "approvePlan">,
  persist: (mode: SessionMode) => void,
): SessionMode {
  const normalized = normalizeSessionMode(mode);
  if (normalized === "plan" && isPlanApproval(request.userMessage, request.approvePlan)) {
    persist("interactive");
    return "interactive";
  }
  return normalized;
}

/** 阶段模型默认值（设置页「阶段模型」卡片的全局配置） */
export interface PhaseModelDefaults {
  planModel?: PhaseModelRef | null;
  actModel?: PhaseModelRef | null;
}

/**
 * 阶段模型解析：仅会话开启 P/A 双模型时生效，优先级
 * 会话阶段覆盖 → 全局阶段默认 → 调用方 fallback（自动路由/默认选择）。
 * plan 模式取 planModel，其余模式（interactive/autopilot）取 actModel。
 * 未开启 P/A 时直接用 fallback（单模型），阶段配置保留但不参与选模。
 */
export function resolvePhaseModel(
  session: SessionRecord,
  mode: SessionMode,
  fallback: { providerId: string | null | undefined; modelId: string | null | undefined },
  defaults?: PhaseModelDefaults,
): { providerId: string | null | undefined; modelId: string | null | undefined } {
  if (session.pairMode !== true) {
    return fallback;
  }
  const providerId = mode === "plan" ? session.planModelProviderId : session.actModelProviderId;
  const modelId = mode === "plan" ? session.planModelId : session.actModelId;
  if (providerId && modelId) {
    return { providerId, modelId };
  }
  const globalDefault = mode === "plan" ? defaults?.planModel : defaults?.actModel;
  if (globalDefault?.providerId && globalDefault.modelId) {
    return { providerId: globalDefault.providerId, modelId: globalDefault.modelId };
  }
  return fallback;
}

/** 各模式的系统提示词追加指令（interactive 返回空串） */
export function sessionModeDirective(mode: SessionMode, permissionMode: PermissionMode): string {
  if (mode === "plan") {
    return [
      "【会话模式 · 计划模式】本会话当前处于「计划模式」，用户希望先看到方案再执行：",
      "- 收到任务后，先产出一份结构化计划清单：目标、分步步骤（带顺序编号）、每步涉及的文件/命令、风险与注意事项；必要时先做只读探查（读文件、搜索代码）来保证计划质量。",
      "- 在用户批准之前，禁止执行任何写入类操作（写/改文件、执行终端命令、提交等）。",
      "- 计划输出完成后立即结束本轮回复，等待用户批准：用户会以「批准执行」消息开始执行，或提出修改意见让你先修订计划再等待批准。",
    ].join("\n");
  }
  if (mode === "autopilot") {
    return [
      `【会话模式 · 自动模式】本会话开启「自动模式」（当前权限模式：${PERMISSION_MODE_LABELS[permissionMode]}），用户希望尽可能自主完成、减少确认打断：`,
      "- 优先自主推进：能自己查到的信息不要再问用户；多种可行方案并存时自行选择最合理的一种并简要说明理由，只在真正需要用户决策（不可逆操作、权限之外、关键信息缺失）时才提问。",
      "- 工具权限仍由权限系统统一管控，需要审批时等待用户处理即可；不要试图绕过或规避审批流程。",
      "- 遇到可自行修复的小错误先修复重试；只在连续失败或方向性问题时停下来汇报。",
    ].join("\n");
  }
  return "";
}

/** 基础系统提示词追加会话模式指令；interactive 时原样返回（不引入多余分隔） */
export function appendSessionModeDirective(
  basePrompt: string,
  mode: SessionMode,
  permissionMode: PermissionMode,
): string {
  const directive = sessionModeDirective(mode, permissionMode);
  if (!directive) {
    return basePrompt;
  }
  return basePrompt ? `${basePrompt}\n\n${directive}` : directive;
}

/**
 * 会话目标（Goals 目标模式）的目标指令：仅目标为 active 时注入；
 * token 预算只做 UI 展示与用量对比，不写进提示词。
 */
export function goalDirective(goal: SessionGoal | null | undefined): string {
  if (!goal || goal.status !== "active") {
    return "";
  }
  return [
    "【会话目标】本会话设定了以下目标，请始终围绕它推进工作：",
    `- 目标：${goal.text}`,
    "- 目标尚未完成时，优先继续推进该目标；若判断目标已达成，在回复中明确说明。",
  ].join("\n");
}

/** 基础系统提示词追加目标指令；无目标 / 非 active 时原样返回 */
export function appendGoalDirective(
  basePrompt: string,
  goal: SessionGoal | null | undefined,
): string {
  const directive = goalDirective(goal);
  if (!directive) {
    return basePrompt;
  }
  return basePrompt ? `${basePrompt}\n\n${directive}` : directive;
}

/** 自动两阶段：plan 模型先出计划，act 模型再执行（关闭手动切模式的负担） */
export interface AutoPlanInput {
  /** 会话是否开启 P/A 双模型；未开启时不做两阶段（与「计划模式」相互独立） */
  pairMode?: boolean;
  mode: SessionMode;
  planProviderId?: string | null;
  planModelId?: string | null;
  actProviderId?: string | null;
  actModelId?: string | null;
  /** 后台会话 / 子 Agent：不触发，避免双倍成本 */
  background?: boolean;
  /** 请求级开关，缺省开启 */
  autoPlan?: boolean;
}

/**
 * 是否走自动两阶段：会话开启 P/A 双模型、非 plan 模式、有独立的 plan 模型，
 * 且与 act 模型不同。plan 模式本身就会用 plan 模型，再预规划会重复。
 */
export function shouldAutoPlan(input: AutoPlanInput): boolean {
  if (input.pairMode !== true) {
    return false;
  }
  if (input.autoPlan === false || input.background) {
    return false;
  }
  if (input.mode === "plan") {
    return false;
  }
  if (!input.planProviderId || !input.planModelId) {
    return false;
  }
  if (!input.actProviderId || !input.actModelId) {
    return false;
  }
  return input.planProviderId !== input.actProviderId || input.planModelId !== input.actModelId;
}

/** 预规划提示词：只要计划，不执行（拿到计划后由 act 模型落地） */
export function buildPlanPrompt(userMessage: string): string {
  return [
    "请为下面这个任务产出一份可执行的计划，不要执行任何操作：",
    "",
    userMessage,
    "",
    "输出要求：",
    "1. 目标一句话；",
    "2. 分步步骤（带顺序编号，每步说明要改哪个文件/跑什么命令）；",
    "3. 风险与需要先确认的点；",
    "4. 不要写代码，不要调用工具，不要复述任务原文。",
  ].join("\n");
}

export const PLAN_SYSTEM_PROMPT =
  "你是负责规划的高级工程师。只产出精炼、可执行的计划，不做实现。";

/** 把预生成计划注入执行段系统提示（plan 文本已作为独立消息落库） */
export function appendPlanDirective(systemPrompt: string, plan: string): string {
  const trimmed = plan.trim();
  if (!trimmed) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n【预生成计划（由计划模型产出，供你执行时参考）】\n${trimmed}\n执行时按这份计划推进；发现计划不可行就在回复里先说明再调整。`;
}
