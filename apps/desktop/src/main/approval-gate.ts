import { completeOnce } from "./model-api";

import type { AgentSettings, CommandApprovalRule } from "@zen/shared";

/**
 * 自动审批闸（接 agent-core 的 AgentSessionConfig.approvalGate）：
 * A. 命令前缀规则——命中 allow 的执行类命令直接放行；
 * B. 帮我核准——审批请求先交当前会话生效模型做安全审查，判定安全则放行并标注理由。
 * 两条路径都未放行（无规则 / ask / 审查判否 / 超时 / 异常）时返回 null，回落人工审批。
 * 防递归：审查用 completeOnce 直连供应商（无工具循环），不会再触发审批。
 */

/** 助手核准的审查超时：超时按失败处理，回落人工审批 */
const REVIEWER_TIMEOUT_MS = 15_000;
/** 审查 prompt 的入参序列化上限：防超大 JSON 撑爆补全请求 */
const REVIEWER_INPUT_MAX_CHARS = 2_000;

/** 闸输入（与 agent-core 侧的 approvalGate 请求形状一致） */
export interface ApprovalGateRequest {
  toolName: string;
  command?: string;
  input: unknown;
}

/** 闸输出：approved=true 自动放行，note 作为 tool_progress 标注透出到 UI */
export interface ApprovalGateVerdict {
  approved: boolean;
  note?: string;
}

/**
 * 命令前缀匹配（trim + startsWith，大小写不敏感）：返回首条命中的规则。
 * 数组顺序即优先级，先命中先赢——把更具体/更严格的规则（如 ask）排在前面
 * 可以覆盖后面的宽规则。
 */
export function matchApprovalRule(
  command: string,
  rules: CommandApprovalRule[],
): CommandApprovalRule | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    rules.find(
      (rule) =>
        typeof rule.pattern === "string" &&
        rule.pattern.trim().length > 0 &&
        normalized.startsWith(rule.pattern.trim().toLowerCase()),
    ) ?? null
  );
}

export interface ReviewerVerdict {
  approved: boolean;
  reason: string;
}

/** 解析审查模型输出里的 JSON 判定；容忍 ```json 围栏与前后杂文，结构不合法返回 null */
export function parseReviewerVerdict(text: string): ReviewerVerdict | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]) as { approved?: unknown; reason?: unknown };
    if (typeof parsed.approved !== "boolean") {
      return null;
    }
    return {
      approved: parsed.approved,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    };
  } catch {
    return null;
  }
}

/** 审查 prompt 的对象描述：有 command 用命令，其余工具序列化入参（限量） */
function describeRequest(request: ApprovalGateRequest): string {
  if (request.command) {
    return `工具：${request.toolName}\n命令：${request.command}`;
  }
  let inputText = "";
  try {
    inputText = JSON.stringify(request.input ?? null) ?? "";
  } catch {
    inputText = String(request.input);
  }
  if (inputText.length > REVIEWER_INPUT_MAX_CHARS) {
    inputText = `${inputText.slice(0, REVIEWER_INPUT_MAX_CHARS)}…`;
  }
  return `工具：${request.toolName}\n入参：${inputText}`;
}

/** 助手模型安全审查：返回 null 表示审查失败（超时/网络/输出不可解析），调用方回落人工 */
async function reviewWithAssistant(
  request: ApprovalGateRequest,
  options: { providerId?: string; modelId?: string },
): Promise<ReviewerVerdict | null> {
  const prompt = [
    "判断以下 Agent 工具调用是否安全到可以自动放行（无需用户逐次确认）。",
    "不安全的标准：破坏系统或文件、外传密钥/凭据/隐私数据、批量抓取隐私数据、安装或运行来路不明的软件、删除或覆盖重要数据、其它明显恶意或破坏性的操作。",
    describeRequest(request),
    '只输出一行 JSON：{"approved": true 或 false, "reason": "一句话理由"}',
  ].join("\n");
  try {
    const text = await completeOnce(prompt, {
      system:
        "你是 Zen 桌面端的命令安全审查器。判断给定的工具调用能否自动放行执行。保持保守：不确定一律判为不通过。只输出 JSON，不要输出其它内容。",
      timeoutMs: REVIEWER_TIMEOUT_MS,
      maxTokens: 2048,
      providerId: options.providerId,
      modelId: options.modelId,
    });
    return parseReviewerVerdict(text);
  } catch {
    return null;
  }
}

export interface ApprovalGateOptions {
  rules: CommandApprovalRule[];
  reviewer: AgentSettings["approvalReviewer"];
  /** 会话生效的供应商/模型（缺省走全局默认选中） */
  providerId?: string;
  modelId?: string;
}

/** 组装自动审批闸：规则优先（确定性），未命中再看「帮我核准」是否开启 */
export function buildApprovalGate(
  options: ApprovalGateOptions,
): (request: ApprovalGateRequest) => Promise<ApprovalGateVerdict | null> {
  return async (request) => {
    const rule = request.command ? matchApprovalRule(request.command, options.rules) : null;
    if (rule) {
      if (rule.decision === "allow") {
        return { approved: true, note: `已按命令规则「${rule.pattern.trim()}」自动放行` };
      }
      // ask=用户对该前缀显式要求人工确认，不让助手模型覆盖
      return null;
    }
    if (options.reviewer === "assistant") {
      const verdict = await reviewWithAssistant(request, options);
      if (verdict?.approved) {
        return {
          approved: true,
          note: `已由助手模型核准：${verdict.reason || "操作判定安全"}`,
        };
      }
    }
    return null;
  };
}
