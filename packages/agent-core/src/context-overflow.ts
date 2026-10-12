import { generateText } from "ai";

import type { ModelMessage } from "ai";

import { createLanguageModel } from "./agent-model";
import type { AgentSessionConfig } from "./agent-config";

/**
 * 上下文管理（确定性部分）：
 * - isContextOverflowError 识别 provider 的超限报错（文案规则集 + 限流措辞否决，
 *   TPM 限流文案同样含 "tokens exceeded"，需先否决避免误判）。
 * - compactMessagesForOverflow 从最旧开始整单元移除消息（assistant tool-call 连同
 *   其 tool 结果，保持配对合法），目标释放 30% 字节量；永不移除最后一条 user 消息
 *   与保护尾。不调用 LLM：溢出时 token 估算已不可信，摘要预算同样会超。
 * - tailWindowForCompact / summarizeWithModel 服务步间主动压缩（P1）：
 *   LLM 结构化摘要替换早期历史，保留完整单元组成的尾部窗口。
 */

/** 主动压缩触发：真实 usage 输入达到窗口的该比例（预留输出 + 安全缓冲，对齐 Roo 20%+10% 思路） */
export const AUTO_COMPACT_RATIO = 0.75;

const DROP_TARGET_RATIO = 0.3;
const PROTECTED_TAIL = 6;
const MIN_DROP_RATIO = 0.02;

/** 裁剪后注入 instructions 的说明，让模型知道早期上下文缺失 */
export const OVERFLOW_TRIM_NOTE =
  "[上下文自动裁剪] 因超出模型上下文窗口，较早的对话与工具输出已被移除；" +
  "如缺少必要的早期细节，请向用户确认或重新读取文件，不要凭空假设。";

/** 主动压缩摘要注入 instructions 的包装（替换旧 instructions：新摘要已包含其要点） */
export function formatCompactSummary(summary: string): string {
  return (
    "[上下文已压缩] 以下是此前对话的结构化摘要；细节以摘要为准，" +
    "需要原文时向用户确认或用工具重新读取文件，不要凭空假设。\n\n" +
    summary.trim()
  );
}

const SUMMARY_GUIDE =
  "你是会话摘要器。把这段对话历史压缩成一份供后续继续工作的结构化摘要，用简洁要点，" +
  "按以下类别组织（没有内容的类别省略）：\n" +
  "1. 用户请求与意图；2. 关键技术概念与决策；3. 已查看/修改的文件及重要代码片段（保留文件路径）；" +
  "4. 报错及修复方式；5. 待办与未完成任务；6. 当前进展与下一步。\n" +
  "保留具体的路径、命令、错误信息原文；不要编造，不要评论，只输出摘要正文。";

/** 默认摘要实现：当前会话模型跑一次无工具的 generateText；previousInstructions 并入 system 以延续要点 */
export async function summarizeWithModel(
  config: AgentSessionConfig,
  messages: ModelMessage[],
  previousInstructions?: string | null,
): Promise<string | null> {
  const system = [previousInstructions ?? undefined, SUMMARY_GUIDE]
    .filter((part): part is string => !!part)
    .join("\n\n");
  const result = await generateText({
    model: createLanguageModel(config),
    system: system || undefined,
    messages,
  });
  return result.text.trim() || null;
}

const RATE_LIMIT_PATTERN =
  /rate[_ -]?limit|too many requests|tokens per minute|\btpm\b|quota|billing|insufficient/i;

const OVERFLOW_PATTERNS: RegExp[] = [
  /context_length_exceeded/i,
  /maximum context length/i,
  /context length exceeds/i,
  /prompt is too long/i,
  /input (is )?too long/i,
  /exceed(s|ed)?[^.]{0,40}context (window|length)/i,
  /context (window|length)[^.]{0,40}(exceed|larger|too small)/i,
  /too many (input )?tokens/i,
  /input token count exceeds/i,
  /max(imum)? prompt tokens/i,
  /request too large/i,
  /reduce the length/i,
  /longer than [^.]{0,30}context/i,
  /超(出|过|限)[^.]{0,12}(上下文|长度)/,
  /(上下文|长度)[^.]{0,8}超(出|过|限)/,
];

/** 从错误对象收集候选文案：message / responseBody / error / cause 链 */
function collectErrorTexts(value: unknown, depth = 0): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (depth > 2 || typeof value !== "object") {
    return [];
  }
  const obj = value as { message?: unknown; cause?: unknown; responseBody?: unknown; error?: unknown };
  const texts: string[] = [];
  if (typeof obj.message === "string") {
    texts.push(obj.message);
  }
  if (typeof obj.responseBody === "string") {
    texts.push(obj.responseBody);
  }
  if (typeof obj.error === "string") {
    texts.push(obj.error);
  }
  texts.push(...collectErrorTexts(obj.cause, depth + 1));
  return texts;
}

export function isContextOverflowError(value: unknown): boolean {
  if (typeof value === "object" && value !== null) {
    const status =
      (value as { statusCode?: unknown }).statusCode ?? (value as { status?: unknown }).status;
    if (Number(status) === 413) {
      return true;
    }
  }
  const texts = collectErrorTexts(value);
  if (!texts.length) {
    return false;
  }
  const matches = (pattern: RegExp) => texts.some((text) => pattern.test(text));
  if (matches(RATE_LIMIT_PATTERN)) {
    return false;
  }
  return OVERFLOW_PATTERNS.some((pattern) => matches(pattern));
}

export interface CompactOverflowResult {
  messages: ModelMessage[];
  droppedCount: number;
}

function hasToolCalls(message: ModelMessage): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((part) => (part as { type?: string }).type === "tool-call")
  );
}

function findLastUserIndex(messages: ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return i;
    }
  }
  return -1;
}

/** 消息按不可拆分单元分段：assistant(tool-call) 连同其后所有 tool 结果，或单条独立消息 */
function segmentUnits(messages: ModelMessage[]): Array<[number, number]> {
  const units: Array<[number, number]> = [];
  let i = 0;
  while (i < messages.length) {
    let end = i + 1;
    if (hasToolCalls(messages[i] as ModelMessage)) {
      while (end < messages.length && messages[end]?.role === "tool") {
        end += 1;
      }
    }
    units.push([i, end]);
    i = end;
  }
  return units;
}

/**
 * 确定性裁剪：返回裁剪后的消息数组；无内容可裁（如单条超大 prompt）返回 null。
 * 保证 tool call/result 配对不拆散；裁剪后首条若非 user，继续丢到 user 边界。
 */
export function compactMessagesForOverflow(messages: ModelMessage[]): CompactOverflowResult | null {
  const sizes = messages.map((message) => JSON.stringify(message).length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const target = total * DROP_TARGET_RATIO;
  const lastUserIdx = findLastUserIndex(messages);
  if (lastUserIdx < 0) {
    return null;
  }
  // 保护尾从最后一条 user 之后算起：run 已产出足量消息时保护 run 尾部，
  // 否则（如首调即超限）不挡历史裁剪——历史正是当时唯一的可释放空间
  const protectedFrom = Math.max(lastUserIdx + 1, messages.length - PROTECTED_TAIL);

  const kept: ModelMessage[] = [];
  let dropped = 0;
  let droppedCount = 0;
  for (const [start, end] of segmentUnits(messages)) {
    const crossesProtectedTail = end > protectedFrom;
    const containsLastUser = start <= lastUserIdx && lastUserIdx < end;
    if (!crossesProtectedTail && !containsLastUser && dropped < target) {
      for (let j = start; j < end; j += 1) {
        dropped += sizes[j] ?? 0;
      }
      droppedCount += end - start;
    } else {
      kept.push(...messages.slice(start, end));
    }
  }

  if (droppedCount === 0 || dropped < total * MIN_DROP_RATIO) {
    return null;
  }
  // 首条非 user 的历史对部分 provider 不合法：继续丢到 user 边界（最后一条 user 必被保留）
  const keptUnits = segmentUnits(kept);
  let trimStart = 0;
  let trimEnd = 0;
  for (const [start, end] of keptUnits) {
    if (kept[start]?.role === "user" || kept.length - start <= PROTECTED_TAIL) {
      break;
    }
    trimEnd = end;
  }
  trimStart = trimEnd;
  return { messages: kept.slice(trimStart), droppedCount };
}

/**
 * 主动压缩保留的尾部窗口：从尾部收集完整单元到 ≥ PROTECTED_TAIL 条，
 * 再回退到 user 边界（最多再延伸 PROTECTED_TAIL 条），保证不拆散 tool 配对。
 */
export function tailWindowForCompact(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= PROTECTED_TAIL) {
    return [...messages];
  }
  const units = segmentUnits(messages);
  let unitIdx = units.length - 1;
  let count = 0;
  let tailStart = messages.length;
  while (unitIdx >= 0 && count < PROTECTED_TAIL) {
    const [start, end] = units[unitIdx] as [number, number];
    tailStart = start;
    count += end - start;
    unitIdx -= 1;
  }
  let extra = 0;
  while (
    unitIdx >= 0 &&
    messages[tailStart]?.role !== "user" &&
    extra < PROTECTED_TAIL
  ) {
    const [start, end] = units[unitIdx] as [number, number];
    tailStart = start;
    extra += end - start;
    unitIdx -= 1;
  }
  return messages.slice(tailStart);
}

/** 会触发文件回灌的工具（路径参数统一叫 path） */
const FILE_TOUCH_TOOLS = new Set(["readFile", "writeFile", "editFile"]);

/**
 * 从被压缩的消息里按时间序提取最近触及的文件路径（readFile/writeFile/editFile），
 * 去重保序、最新在后，最多 limit 个——供压缩后重读当前内容回灌 instructions。
 */
export function recentTouchedFilePaths(messages: ModelMessage[], limit = 5): string[] {
  const paths: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      const call = part as { type?: string; toolName?: string; input?: { path?: unknown } };
      if (call.type !== "tool-call" || !FILE_TOUCH_TOOLS.has(call.toolName ?? "")) {
        continue;
      }
      const path = call.input?.path;
      if (typeof path === "string" && path) {
        paths.push(path);
      }
    }
  }
  const unique: string[] = [];
  for (let i = paths.length - 1; i >= 0 && unique.length < limit; i -= 1) {
    const path = paths[i] as string;
    if (!unique.includes(path)) {
      unique.push(path);
    }
  }
  return unique.reverse();
}
