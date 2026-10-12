import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type {
  AskUserQuestionEvent,
  LarkGatewayState,
  LarkProjectSummary,
  LarkQuickCommand,
  LarkSessionState,
  LarkSessionSummary,
  WorkspaceGroup,
} from "@zen/shared";

import { currentLocale, mainT } from "../i18n";
import type { MainLocale } from "../i18n";
import { acquireLarkBridgeLock, releaseLarkBridgeLock } from "./bridge-lock";
import type { LarkBridgeLockResult } from "./bridge-lock";
import { readLarkAuthSnapshot } from "./auth";
import { resolveLarkCliPath } from "./cli";
import {
  checkoutBranch as defaultCheckoutBranch,
  commitAll as defaultCommitAll,
  listBranches as defaultListBranches,
} from "./git-ops";
import type { BranchListResult, CheckoutResult, CommitResult } from "./git-ops";

const execFileAsync = promisify(execFile);

/**
 * 飞书网关：监听 lark-cli event consume 长连接，处理私信指令（列表/状态/帮助），
 * 并把会话 askUser 问询推送到飞书、把飞书回复写回会话。
 *
 * 纯逻辑（NDJSON 解析、事件过滤、去重、指令/回复解析、文案渲染）拆成具名导出
 * 函数供单元测试直接覆盖；进程管理（spawn/execFile）走模块底部薄封装，
 * 测试不打真实网络。
 *
 * 用户可见文案统一走 main-i18n 字典（尾部 locale 参数默认 zh-CN，
 * 类内文案用网关启动时读到的 currentLocale）。
 */

// ---------- 纯逻辑：事件行解析与过滤 ----------

/** lark-cli event consume stdout 单行扁平 JSON 的所需字段 */
export interface LarkEventRecord {
  messageId: string;
  chatId: string;
  chatType: string;
  messageType: string;
  senderId: string;
  senderType: string;
  content: string;
}

/** 单行 NDJSON → 事件记录；空行/坏 JSON/缺 message_id 返回 null */
export function parseLarkEventLine(line: string): LarkEventRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const str = (key: string): string => (typeof obj[key] === "string" ? (obj[key] as string) : "");
  // message_id 是去重键，缺失的行不可安全处理
  const messageId = str("message_id");
  if (!messageId) {
    return null;
  }
  return {
    messageId,
    chatId: str("chat_id"),
    chatType: str("chat_type"),
    messageType: str("message_type"),
    senderId: str("sender_id"),
    senderType: str("sender_type"),
    content: str("content"),
  };
}

/**
 * 事件准入：只处理白名单用户在 bot 私信里发的文本消息。
 * allowedOpenId 为空（未锁定操控者）时全部忽略，避免任何人借 bot 操控 zen。
 */
export function isHandleableLarkEvent(
  record: LarkEventRecord,
  allowedOpenId: string | null,
): boolean {
  if (!allowedOpenId || record.senderId !== allowedOpenId) {
    return false;
  }
  return (
    record.senderType === "user" && record.messageType === "text" && record.chatType === "p2p"
  );
}

/** message_id 去重表（保留最近 limit 条，FIFO 淘汰） */
export class LarkMessageDeduper {
  private readonly seen = new Set<string>();

  constructor(private readonly limit = 200) {}

  /** true = 首次出现（放行）；false = 重复（忽略） */
  firstSeen(messageId: string): boolean {
    if (this.seen.has(messageId)) {
      return false;
    }
    this.seen.add(messageId);
    while (this.seen.size > this.limit) {
      const oldest = this.seen.values().next().value;
      if (oldest === undefined) {
        break;
      }
      this.seen.delete(oldest);
    }
    return true;
  }
}

// ---------- 纯逻辑：会话状态映射与清单/状态文案 ----------

/** AgentSession.getRunState() 的结构快照（不直接依赖 agent-core，测试无 electron 链路） */
export interface SessionRunState {
  runActive: boolean;
  paused: boolean;
  waitingApproval: boolean;
  waitingAskCount: number;
  inserting: boolean;
}

/** 运行状态 → 飞书侧展示状态；无会话对象（null）→ 空闲 */
export function mapRunStateToLarkState(state: SessionRunState | null | undefined): LarkSessionState {
  if (!state) {
    return "idle";
  }
  // 优先级：插入执行是特殊的运行形态 → 暂停 → 等审批 → 等回答 → 运行中；
  // run 已结束（runActive=false 且无挂起）的残留会话对象按空闲展示
  if (state.inserting) {
    return "running";
  }
  if (state.paused) {
    return "paused";
  }
  if (state.waitingApproval) {
    return "waiting-approval";
  }
  if (state.waitingAskCount > 0) {
    return "waiting-ask";
  }
  return state.runActive ? "running" : "idle";
}

/** 运行状态 → 展示标签文案（按 locale 取词） */
export function larkStateLabel(state: LarkSessionState, locale: MainLocale = "zh-CN"): string {
  switch (state) {
    case "idle":
      return mainT(locale, "lark.state.idle");
    case "running":
      return mainT(locale, "lark.state.running");
    case "waiting-approval":
      return mainT(locale, "lark.state.waitingApproval");
    case "waiting-ask":
      return mainT(locale, "lark.state.waitingAsk");
    case "paused":
      return mainT(locale, "lark.state.paused");
  }
}

/** 工作区分组拍平 → 未归档会话按更新时间倒序取前 limit 条（「列表」指令数据源） */
export function collectSessionSummaries(
  groups: WorkspaceGroup[],
  stateOf: (sessionId: string) => LarkSessionState,
  limit = 10,
): LarkSessionSummary[] {
  const all = groups.flatMap((group) => group.sessions);
  return all
    .filter((session) => !session.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((session) => ({
      id: session.id,
      title: session.title,
      state: stateOf(session.id),
      updatedAt: session.updatedAt,
    }));
}

export function formatRelativeTime(
  ts: number,
  now: number = Date.now(),
  locale: MainLocale = "zh-CN",
): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) {
    return mainT(locale, "lark.time.justNow");
  }
  if (diff < hour) {
    return mainT(locale, "lark.time.minutesAgo", { n: Math.floor(diff / minute) });
  }
  if (diff < day) {
    return mainT(locale, "lark.time.hoursAgo", { n: Math.floor(diff / hour) });
  }
  return mainT(locale, "lark.time.daysAgo", { n: Math.floor(diff / day) });
}

export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 「列表」指令回复 */
export function buildSessionsReply(
  summaries: LarkSessionSummary[],
  now = Date.now(),
  locale: MainLocale = "zh-CN",
): string {
  if (!summaries.length) {
    return mainT(locale, "lark.sessions.empty");
  }
  const lines = summaries.map(
    (item, index) =>
      `${index + 1}. ${item.title} · ${larkStateLabel(item.state, locale)} · ${formatRelativeTime(item.updatedAt, now, locale)}`,
  );
  return [mainT(locale, "lark.sessions.header"), ...lines].join("\n");
}

/** 「状态」指令回复：只列非空闲会话，附首个待答问询（截断 80 字） */
export function buildStatusReply(
  summaries: LarkSessionSummary[],
  pendingQuestionOf: (sessionId: string) => string | null,
  now = Date.now(),
  locale: MainLocale = "zh-CN",
): string {
  const active = summaries.filter((item) => item.state !== "idle");
  if (!active.length) {
    return mainT(locale, "lark.status.empty");
  }
  const lines = active.map((item, index) => {
    const base = `${index + 1}. ${item.title} · ${larkStateLabel(item.state, locale)} · ${formatRelativeTime(item.updatedAt, now, locale)}`;
    const question = pendingQuestionOf(item.id);
    return question ? `${base}\n   ❓ ${truncateText(question, 80)}` : base;
  });
  return [mainT(locale, "lark.status.header"), ...lines].join("\n");
}

/** 「帮助」指令回复（卡片降级文案；「菜单」同款内容见 buildMenuCard） */
export function buildHelpReply(
  quickCommands: LarkQuickCommand[] = [],
  locale: MainLocale = "zh-CN",
): string {
  const lines = [
    mainT(locale, "lark.help.title"),
    mainT(locale, "lark.cmd.sessions"),
    mainT(locale, "lark.cmd.status"),
    mainT(locale, "lark.cmd.projects"),
    mainT(locale, "lark.cmd.chat"),
    mainT(locale, "lark.cmd.new"),
    mainT(locale, "lark.cmd.continue"),
    mainT(locale, "lark.cmd.branches"),
    mainT(locale, "lark.cmd.checkout"),
    mainT(locale, "lark.cmd.commit"),
    mainT(locale, "lark.help.last"),
    mainT(locale, "lark.help.note1"),
    mainT(locale, "lark.help.note2"),
  ];
  const quick = buildQuickCommandLines(quickCommands, locale);
  return [...lines, ...quick].join("\n");
}

/** 自定义快捷命令的清单行（帮助文案与菜单卡片共用） */
export function buildQuickCommandLines(
  quickCommands: LarkQuickCommand[],
  locale: MainLocale = "zh-CN",
): string[] {
  if (!quickCommands.length) {
    return [];
  }
  return [
    mainT(locale, "lark.quick.header"),
    ...quickCommands.map(
      (item) => `• /${item.alias} — ${item.label || item.alias}（${truncateText(item.prompt, 60)}）`,
    ),
  ];
}

// ---------- 纯逻辑：项目/分支/提交指令解析与文案 ----------

export type LarkCommand = "sessions" | "status" | "help" | "projects" | "quick";

/** 指令全等匹配（去空白、大小写不敏感）；非指令文本返回 null 走问询回复解析 */
export function parseLarkCommand(text: string): LarkCommand | null {
  const normalized = text.trim().toLowerCase();
  if (
    normalized === "列表" ||
    normalized === "会话" ||
    normalized === "清单" ||
    normalized === "sessions"
  ) {
    return "sessions";
  }
  if (normalized === "状态" || normalized === "进度" || normalized === "status") {
    return "status";
  }
  if (
    normalized === "帮助" ||
    normalized === "help" ||
    normalized === "菜单" ||
    normalized === "menu" ||
    normalized === "功能列表" ||
    normalized === "指令"
  ) {
    return "help";
  }
  if (normalized === "项目" || normalized === "projects") {
    return "projects";
  }
  if (normalized === "快捷命令" || normalized === "quick") {
    return "quick";
  }
  return null;
}

/** 「添加/删除快捷命令」指令的解析结果 */
export interface ParsedQuickManageCommand {
  kind: "quick-add" | "quick-del";
  /** 别名（quick-add/quick-del 均不带斜杠前缀） */
  alias: string;
  /** quick-add 的提示词（整段剩余文本）；quick-del 为空串 */
  prompt: string;
}

/**
 * 快捷命令管理指令解析：
 * - 添加快捷命令 <别名> <提示词> / quick-add <alias> <prompt>（存在则更新）
 * - 删除快捷命令 <别名> / quick-del <alias>
 */
export function parseQuickManageCommand(text: string): ParsedQuickManageCommand | null {
  const headMatch = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!headMatch) {
    return null;
  }
  const head = (headMatch[1] ?? "").toLowerCase();
  const rest = (headMatch[2] ?? "").trim();
  const aliasMatch = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
  const alias = (aliasMatch?.[1] ?? "").replace(/^\/+/, "");
  const prompt = (aliasMatch?.[2] ?? "").trim();
  if (head === "添加快捷命令" || head === "新增快捷命令" || head === "quick-add") {
    return { kind: "quick-add", alias, prompt };
  }
  if (head === "删除快捷命令" || head === "移除快捷命令" || head === "quick-del") {
    return { kind: "quick-del", alias, prompt: "" };
  }
  return null;
}

/** 带参数指令（对话/分支/切换/提交/新会话/继续）的解析结果 */
export interface ParsedProjectCommand {
  kind: "chat" | "branches" | "checkout" | "commit" | "new" | "continue";
  /** 第一个参数（项目名，包含匹配）；new/continue 无项目参数，恒为 "" */
  project: string;
  /** 第二个参数（消息 / 分支名 / 提交说明）；new/continue 为整段消息；缺失为 "" */
  arg: string;
}

/**
 * 带参数指令解析：第一个 token 是指令词（大小写不敏感），其余为参数。
 * - 对话 <项目> <消息> / chat <project> <message>
 * - 分支 <项目> / branches <project>（项目名取整段剩余文本，允许含空格）
 * - 切换 <项目> <分支> / checkout <project> <branch>
 * - 提交 <项目> <说明> / commit <project> <message>
 * - 新会话 <消息> / new <message>（强制新建会话）
 * - 继续 <消息> / continue <message>（追加到当前绑定会话）
 */
export function parseProjectCommand(text: string): ParsedProjectCommand | null {
  const headMatch = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!headMatch) {
    return null;
  }
  const head = (headMatch[1] ?? "").toLowerCase();
  const rest = (headMatch[2] ?? "").trim();
  const splitTwo = (value: string): { first: string; remainder: string } => {
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(value);
    return { first: (match?.[1] ?? "").trim(), remainder: (match?.[2] ?? "").trim() };
  };
  const parts = splitTwo(rest);
  if (head === "对话" || head === "chat") {
    return { kind: "chat", project: parts.first, arg: parts.remainder };
  }
  if (head === "分支" || head === "branches") {
    return { kind: "branches", project: rest, arg: "" };
  }
  if (head === "切换" || head === "checkout") {
    return { kind: "checkout", project: parts.first, arg: parts.remainder };
  }
  if (head === "提交" || head === "commit") {
    return { kind: "commit", project: parts.first, arg: parts.remainder };
  }
  if (head === "新会话" || head === "new") {
    return { kind: "new", project: "", arg: rest };
  }
  if (head === "继续" || head === "continue") {
    return { kind: "continue", project: "", arg: rest };
  }
  return null;
}

/** 项目名包含匹配（名称与路径末段，大小写不敏感） */
export function matchProjectSummaries(
  query: string,
  projects: LarkProjectSummary[],
): LarkProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return projects.filter((project) => {
    const base = project.path.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
    return project.name.toLowerCase().includes(q) || base.includes(q);
  });
}

/** 「项目」指令回复 */
export function buildProjectsReply(
  projects: LarkProjectSummary[],
  now = Date.now(),
  locale: MainLocale = "zh-CN",
): string {
  if (!projects.length) {
    return mainT(locale, "lark.projects.empty");
  }
  const lines = projects.map(
    (project, index) =>
      `${index + 1}. ${project.name} · ${project.path} · ${formatRelativeTime(project.lastActiveAt, now, locale)}`,
  );
  return [mainT(locale, "lark.projects.header"), ...lines].join("\n");
}

/** 项目歧义/未命中时的候选清单 */
export function buildProjectCandidatesReply(
  query: string,
  matches: LarkProjectSummary[],
  now = Date.now(),
  locale: MainLocale = "zh-CN",
): string {
  const label = mainT(locale, "lark.projects.matchLabel", { query: truncateText(query, 40) });
  if (!matches.length) {
    return mainT(locale, "lark.projects.notFound", { label });
  }
  const lines = matches.map(
    (project, index) =>
      `${index + 1}. ${project.name} · ${project.path} · ${formatRelativeTime(project.lastActiveAt, now, locale)}`,
  );
  return [mainT(locale, "lark.projects.ambiguous", { label }), ...lines].join("\n");
}

/** 「分支」指令回复：标记当前分支 */
export function buildBranchesReply(
  project: LarkProjectSummary,
  result: { current: string; branches: string[] },
  locale: MainLocale = "zh-CN",
): string {
  if (!result.branches.length) {
    return mainT(locale, "lark.branches.empty", { name: project.name });
  }
  const currentLabel = mainT(locale, "lark.branches.current");
  const lines = result.branches.map((branch) =>
    branch === result.current ? `• ${branch} ${currentLabel}` : `• ${branch}`,
  );
  return [mainT(locale, "lark.branches.header", { name: project.name }), ...lines].join("\n");
}

// ---------- 纯逻辑：自定义快捷命令（/别名）解析与展开 ----------

/** 「/别名 [附加文本]」的解析结果 */
export interface ParsedQuickCommand {
  /** 别名（已小写化，匹配时不区分大小写） */
  alias: string;
  /** 别名后的附加文本；无则空串 */
  arg: string;
}

/**
 * 快捷命令解析：整段首个 token 必须是 /别名（别名内不含斜杠）才算快捷命令，
 * 含内部斜杠的路径类文本（如 /Users/x/y）原样放行，不误伤普通消息。
 */
export function parseQuickCommand(text: string): ParsedQuickCommand | null {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  return { alias: (match[1] ?? "").toLowerCase(), arg: (match[2] ?? "").trim() };
}

/** 快捷命令展开：prompt 含 $1 时用附加文本整体替换，否则追加在 prompt 之后 */
export function expandQuickCommand(prompt: string, arg: string): string {
  const base = prompt.trim();
  if (base.includes("$1")) {
    return base.replace(/\$1/g, arg).trim();
  }
  return arg ? `${base} ${arg}` : base;
}

/** 带参数指令的用法提示 */
export function buildProjectCommandUsage(
  kind: ParsedProjectCommand["kind"],
  locale: MainLocale = "zh-CN",
): string {
  switch (kind) {
    case "chat":
      return mainT(locale, "lark.usage.chat");
    case "branches":
      return mainT(locale, "lark.usage.branches");
    case "checkout":
      return mainT(locale, "lark.usage.checkout");
    case "commit":
      return mainT(locale, "lark.usage.commit");
    case "new":
      return mainT(locale, "lark.usage.new");
    case "continue":
      return mainT(locale, "lark.usage.continue");
  }
}

/** 网关内待答问询（含推送序号；飞书侧用 #N 指定回答哪条） */
export interface LarkPendingAsk {
  askId: string;
  /** 归属会话 id（统一为父会话，done 事件按它清理） */
  sessionId: string;
  sessionTitle: string;
  /** 递增推送序号 */
  seq: number;
  question: AskUserQuestionEvent;
  /** 问询卡片发出后回填的飞书 message_id（卡片回调按它定位问询） */
  messageId?: string;
}

/** 「问询推送」的 markdown 文案（多条待答时尾注换成 #序号 指引） */
export function buildAskPushText(
  entry: LarkPendingAsk,
  pendingCount: number,
  locale: MainLocale = "zh-CN",
): string {
  const question = entry.question;
  const lines = [
    mainT(locale, "lark.ask.title", {
      title: entry.sessionTitle || mainT(locale, "lark.sessionFallback"),
    }),
  ];
  if (question.agentName) {
    lines.push(mainT(locale, "lark.ask.from", { name: question.agentName }));
  }
  lines.push(question.question);
  if (question.options.length) {
    lines.push("");
    question.options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option}`);
    });
    if (question.multiSelect) {
      lines.push(mainT(locale, "lark.ask.multiSelectHint"));
    }
  }
  lines.push("");
  lines.push(
    pendingCount > 1
      ? mainT(locale, "lark.ask.multiPendingTail", { seq: entry.seq })
      : mainT(locale, "lark.ask.directReplyTail"),
  );
  return lines.join("\n");
}

/** 飞书 interactive 卡片（im +messages-send --msg-type interactive 的 content JSON） */
export interface LarkCard {
  config?: { wide_screen_mode?: boolean };
  header?: { title: { tag: "plain_text"; content: string }; template: string };
  elements: unknown[];
}

function cardOf(header: { title: string; template: string }, body: string, note: string): LarkCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: header.title }, template: header.template },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: body } },
      { tag: "hr" },
      { tag: "note", elements: [{ tag: "plain_text", content: note }] },
    ],
  };
}

/** 飞书 interactive 卡片 2.0（schema 2.0：组件直接放 body.elements，按钮不再包 action 容器） */
export interface LarkCard2 {
  schema: "2.0";
  config: { update_multi: boolean; width_mode: string };
  header: { title: { tag: "plain_text"; content: string }; template: string };
  body: { elements: unknown[] };
}

/**
 * 卡片交互元素回调 value 的统一载荷。
 *
 * 重要：Card 2.0 的 behaviors.value 直接放**对象**（不 JSON.stringify）——
 * 传字符串会导致回传 action_value 双重编码（'"{\"k\":...}"'），解析失败后
 * 点击无任何反应（v1 的线上根因）。解析侧同时兼容对象 / JSON 字符串 /
 * 双重编码字符串三种形态，保证旧卡片与新卡片都能路由。
 */
export interface AskActionValue {
  k: "ask";
  askId: string;
  seq: number;
  /** 选项原文，写回时直接使用；form 提交按钮为空串 */
  a: string;
}

/** behaviors.value 用的对象形态（勿再序列化） */
export function askActionValueOf(askId: string, seq: number, answer: string): AskActionValue {
  return { k: "ask", askId, seq, a: answer };
}

/** 兼容旧测试/旧卡片的字符串形态（序列化） */
export function buildAskActionValue(askId: string, seq: number, answer: string): string {
  return JSON.stringify(askActionValueOf(askId, seq, answer));
}

/** 字符串 → 尽力解一层 JSON（双重编码时解两层）；非字符串原样返回 */
function decodeMaybeJson(raw: unknown): unknown {
  let value = raw;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 回调 value → 问询载荷；接受对象 / JSON 字符串 / 双重编码字符串 */
export function parseAskActionValue(raw: unknown): AskActionValue | null {
  const obj = decodeMaybeJson(raw);
  if (!isPlainObject(obj)) {
    return null;
  }
  if (
    obj.k !== "ask" ||
    typeof obj.askId !== "string" ||
    !obj.askId ||
    typeof obj.seq !== "number" ||
    typeof obj.a !== "string"
  ) {
    return null;
  }
  return { k: "ask", askId: obj.askId, seq: obj.seq, a: obj.a };
}

/** 菜单卡片按钮回调载荷：k="cmd"，t 为等价于用户输入的指令/快捷命令文本 */
export interface CmdActionValue {
  k: "cmd";
  t: string;
}

/** behaviors.value 用的对象形态（勿再序列化） */
export function cmdActionValueOf(text: string): CmdActionValue {
  return { k: "cmd", t: text };
}

export function buildCmdActionValue(text: string): string {
  return JSON.stringify(cmdActionValueOf(text));
}

/** 回调 value → 指令载荷；接受对象 / JSON 字符串 / 双重编码字符串 */
export function parseCmdActionValue(raw: unknown): CmdActionValue | null {
  const obj = decodeMaybeJson(raw);
  if (!isPlainObject(obj)) {
    return null;
  }
  if (obj.k !== "cmd" || typeof obj.t !== "string" || !obj.t.trim()) {
    return null;
  }
  return { k: "cmd", t: obj.t };
}

/** 按钮回调里的指令文本（非问询按钮）；不是指令按钮返回 null */
export function extractCardCommand(record: LarkCardActionRecord): string | null {
  if (record.actionTag !== "button") {
    return null;
  }
  return parseCmdActionValue(record.actionValue)?.t ?? null;
}

function plainText(content: string): { tag: "plain_text"; content: string } {
  return { tag: "plain_text", content };
}

/** select/multi_select 选项：value 用选项原文（组件要求 value 为字符串且唯一） */
function askSelectOption(
  option: string,
): { text: { tag: "plain_text"; content: string }; value: string } {
  return { text: plainText(option), value: option };
}

/** form 内提交/取消按钮（表单按钮不用 behaviors，靠 action_name 区分意图） */
function formButton(label: string, name: string, primary: boolean): Record<string, unknown> {
  return {
    tag: "button",
    text: plainText(label),
    type: primary ? "primary_filled" : "default",
    form_action_type: "submit",
    name,
  };
}

/**
 * 「问询推送」卡片（Card 2.0 表单式）：
 * - 有选项 → select_static（单选）/ multi_select_static（多选），value=选项原文；
 * - allowFreeText → input 补充输入框（无选项时为唯一答案入口，required）；
 * - 取消（btn_cancel，放弃在飞书回答）/ 确认（btn_ok，提交）两个独立按钮，
 *   放在 form 内 column_set 并排；表单提交经 form_value 回传，askId 由
 *   发送侧记录的 message_id 映射兜底（form 按钮无法携带回调 value）。
 * - 无选项且不允许自由输入 → 无交互元素，纯文本引导回复。
 */
export function buildAskPushCard(
  entry: LarkPendingAsk,
  _pendingCount: number,
  locale: MainLocale = "zh-CN",
): LarkCard2 {
  const question = entry.question;
  const lines: string[] = [];
  if (question.agentName) {
    lines.push(mainT(locale, "lark.ask.cardFrom", { name: question.agentName }));
  }
  lines.push(`**${question.question}**`);
  if (question.multiSelect) {
    lines.push("");
    lines.push(`<font color='grey'>${mainT(locale, "lark.ask.multiSelectHint")}</font>`);
  }
  const elements: unknown[] = [{ tag: "markdown", content: lines.join("\n") }];

  const hasOptions = question.options.length > 0;
  const hasInput = question.allowFreeText !== false;
  if (hasOptions || hasInput) {
    const formElements: Record<string, unknown>[] = [];
    if (hasOptions) {
      formElements.push({
        tag: question.multiSelect ? "multi_select_static" : "select_static",
        name: "pick",
        required: !hasInput,
        placeholder: plainText(
          mainT(
            locale,
            question.multiSelect ? "lark.ask.selectPlaceholderMulti" : "lark.ask.selectPlaceholder",
          ),
        ),
        options: question.options.map((option) => askSelectOption(option)),
      });
    }
    if (hasInput) {
      formElements.push({
        tag: "input",
        name: "text",
        required: !hasOptions,
        input_type: "text",
        max_length: 1000,
        placeholder: plainText(
          mainT(locale, hasOptions ? "lark.ask.textOptionalPlaceholder" : "lark.ask.textRequiredPlaceholder"),
        ),
      });
    }
    formElements.push({
      tag: "column_set",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [formButton(mainT(locale, "lark.ask.cancelLabel"), "btn_cancel", false)],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [formButton(mainT(locale, "lark.ask.confirmLabel"), "btn_ok", true)],
        },
      ],
    });
    elements.push({ tag: "form", name: "form_ask", elements: formElements });
  }

  elements.push(
    { tag: "hr" },
    {
      // schema 2.0 不再支持 note 组件：用灰色 markdown 呈现回复指引
      tag: "markdown",
      content: `<font color='grey'>${mainT(locale, "lark.ask.cardNote")}</font>`,
    },
  );
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(
        mainT(locale, "lark.ask.title", {
          title: entry.sessionTitle || mainT(locale, "lark.sessionFallback"),
        }),
      ),
      template: "wathet",
    },
    body: { elements },
  };
}

/** 「问询已回答」卡片（延迟更新替换原卡片）：正文显示已选答案，去掉交互组件 */
export function buildAskAnsweredCard(
  entry: LarkPendingAsk,
  answer: string,
  locale: MainLocale = "zh-CN",
): LarkCard2 {
  const lines: string[] = [];
  if (entry.question.agentName) {
    lines.push(mainT(locale, "lark.ask.cardFrom", { name: entry.question.agentName }));
  }
  lines.push(entry.question.question);
  lines.push("");
  lines.push(mainT(locale, "lark.ask.answeredPick", { answer }));
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(
        mainT(locale, "lark.ask.answeredTitle", {
          title: entry.sessionTitle || mainT(locale, "lark.sessionFallback"),
        }),
      ),
      template: "green",
    },
    body: {
      elements: [
        { tag: "markdown", content: lines.join("\n") },
        { tag: "hr" },
        { tag: "markdown", content: `<font color='grey'>${mainT(locale, "lark.ask.answeredNote")}</font>` },
      ],
    },
  };
}

/** 「问询已取消」卡片（延迟更新替换原卡片）：取消在飞书回答，问询仍可在 Zen 内回答 */
export function buildAskCancelledCard(
  entry: LarkPendingAsk,
  locale: MainLocale = "zh-CN",
): LarkCard2 {
  const lines: string[] = [];
  if (entry.question.agentName) {
    lines.push(mainT(locale, "lark.ask.cardFrom", { name: entry.question.agentName }));
  }
  lines.push(entry.question.question);
  lines.push("");
  lines.push(mainT(locale, "lark.ask.cancelledPick"));
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(
        mainT(locale, "lark.ask.cancelledTitle", {
          title: entry.sessionTitle || mainT(locale, "lark.sessionFallback"),
        }),
      ),
      template: "grey",
    },
    body: {
      elements: [
        { tag: "markdown", content: lines.join("\n") },
        { tag: "hr" },
        { tag: "markdown", content: `<font color='grey'>${mainT(locale, "lark.ask.cancelledNote")}</font>` },
      ],
    },
  };
}

/** 「会话完成」卡片：标题=会话名，正文=最终助手回复摘要（截断 800 字） */
export function buildSessionDoneCard(
  title: string,
  reply: string,
  locale: MainLocale = "zh-CN",
): LarkCard {
  return cardOf(
    { title: mainT(locale, "lark.session.doneTitle", { title }), template: "green" },
    truncateText(reply, 800),
    mainT(locale, "lark.session.doneNote"),
  );
}

/** 菜单按钮（Card 2.0）：点击回调 CmdActionValue，等价于用户直接输入该指令文本 */
function menuButton(label: string, text: string, primary = false): Record<string, unknown> {
  return {
    tag: "button",
    text: plainText(label),
    type: primary ? "primary_filled" : "default",
    behaviors: [{ type: "callback", value: buildCmdActionValue(text) }],
  };
}

/** 「菜单/帮助」卡片（Card 2.0）：指令清单 + 可点按钮（内置常用指令 + 自定义快捷命令） */
export function buildMenuCard(
  quickCommands: LarkQuickCommand[] = [],
  locale: MainLocale = "zh-CN",
): LarkCard2 {
  const lines = [
    mainT(locale, "lark.cmd.sessions"),
    mainT(locale, "lark.cmd.status"),
    mainT(locale, "lark.cmd.projects"),
    mainT(locale, "lark.cmd.chat"),
    mainT(locale, "lark.cmd.new"),
    mainT(locale, "lark.cmd.continue"),
    mainT(locale, "lark.cmd.branches"),
    mainT(locale, "lark.cmd.checkout"),
    mainT(locale, "lark.cmd.commit"),
    mainT(locale, "lark.menu.last"),
  ];
  lines.push("", ...buildQuickCommandLines(quickCommands, locale));
  const elements: unknown[] = [{ tag: "markdown", content: lines.join("\n") }, { tag: "hr" }];
  // 常用查询指令按钮；自定义快捷命令一键点选（按钮回调与直接输入等价）
  elements.push(
    menuButton(mainT(locale, "lark.menu.statusBtn"), mainT(locale, "lark.cmdWord.status"), true),
    menuButton(mainT(locale, "lark.menu.sessionsBtn"), mainT(locale, "lark.cmdWord.sessions")),
    menuButton(mainT(locale, "lark.menu.projectsBtn"), mainT(locale, "lark.cmdWord.projects")),
  );
  for (const item of quickCommands) {
    elements.push(menuButton(`⚡ ${item.label || item.alias}`, `/${item.alias}`));
  }
  elements.push({
    // schema 2.0 不再支持 note 组件：用灰色 markdown 呈现回复指引
    tag: "markdown",
    content: `<font color='grey'>${mainT(locale, "lark.menu.footer")}</font>`,
  });
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(mainT(locale, "lark.menu.title")),
      template: "blue",
    },
    body: { elements },
  };
}

/**
 * 通用清单卡片（Card 2.0）：每条 = 加粗标题 + 灰色副标题（路径/状态/时间），
 * 顶部指标列（可选）+ 列表 markdown + 灰色脚注；会话/项目/分支等查询共用。
 */
export interface ListCardItem {
  title: string;
  subtitle: string;
}

export function buildListCard(options: {
  title: string;
  template: string;
  emptyText: string;
  items: ListCardItem[];
  metrics?: Array<{ label: string; value: string }>;
  footer?: string;
}): LarkCard2 {
  const elements: unknown[] = [];
  if (options.metrics?.length) {
    elements.push({
      tag: "column_set",
      flex_mode: "bisect",
      columns: options.metrics.map((metric) => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        elements: [
          {
            tag: "markdown",
            text_align: "center",
            content: `**${metric.value}**\n<font color='grey'>${metric.label}</font>`,
          },
        ],
      })),
    });
  }
  if (!options.items.length) {
    elements.push({
      tag: "markdown",
      content: `<font color='grey'>${options.emptyText}</font>`,
    });
  } else {
    elements.push({
      tag: "markdown",
      content: options.items.map((item) => `${item.title}\n${item.subtitle}`).join("\n\n"),
    });
  }
  elements.push({ tag: "hr" });
  if (options.footer) {
    elements.push({ tag: "markdown", content: `<font color='grey'>${options.footer}</font>` });
  }
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: { title: plainText(options.title), template: options.template },
    body: { elements },
  };
}

/**
 * 快捷命令管理卡片（Card 2.0）：现有命令清单（每条带一键执行按钮）+
 * 管理用法说明（添加/删除指令）；空清单时给引导文案。
 */
export function buildQuickManageCard(
  quickCommands: LarkQuickCommand[] = [],
  locale: MainLocale = "zh-CN",
): LarkCard2 {
  const lines: string[] = [];
  if (!quickCommands.length) {
    lines.push(`<font color='grey'>${mainT(locale, "lark.quick.cardEmpty")}</font>`);
  } else {
    for (const item of quickCommands) {
      lines.push(`**/${item.alias}** — ${item.label || item.alias}`);
      lines.push(`<font color='grey'>${truncateText(item.prompt, 100)}</font>`);
      lines.push("");
    }
  }
  lines.push(mainT(locale, "lark.quick.usageAdd"));
  lines.push(mainT(locale, "lark.quick.usageDel"));
  const elements: unknown[] = [
    { tag: "markdown", content: lines.join("\n").trim() },
    { tag: "hr" },
  ];
  for (const item of quickCommands) {
    elements.push(menuButton(`⚡ /${item.alias}`, `/${item.alias}`));
  }
  elements.push({
    tag: "markdown",
    content: `<font color='grey'>${mainT(locale, "lark.quick.cardFooter")}</font>`,
  });
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: { title: plainText(mainT(locale, "lark.quick.cardTitle")), template: "violet" },
    body: { elements },
  };
}

/**
 * 选项编号答案 → 选项文本；不匹配（非纯数字组合 / 越界）返回 null（用原文回答）。
 * 拼接方式镜像 UI 多选提交（AskUserCard.submitPicked：picked.join("、")）。
 */
export function mapOptionAnswer(answer: string, options: string[]): string | null {
  const trimmed = answer.trim();
  if (!trimmed || !options.length) {
    return null;
  }
  const picked: string[] = [];
  for (const part of trimmed.split(/[,，、]/)) {
    const token = part.trim();
    if (!/^\d+$/.test(token)) {
      return null;
    }
    const option = options[Number(token) - 1];
    if (option === undefined) {
      return null;
    }
    picked.push(option);
  }
  return picked.join("、");
}

export interface AskReplyResult {
  /** 回给用户的确认/提示文案 */
  reply: string;
  /** 写回成功的 askId（网关标记为自己 resolve，ask_resolved 事件不再补提示） */
  resolvedAskIds: string[];
  /** 写回失败（askId 已失效）需要从待答表移除的 askId */
  invalidAskIds: string[];
}

/**
 * 把一条飞书文本解析成问询答案并尝试写回。
 * - 无待答 → 提示没有待回答问询；
 * - 单条待答 → 整段文本即答案；
 * - 多条待答 → 必须 #N 前缀（N 为推送序号），否则列出当前待答序号；
 * - 答案为纯数字/逗号顿号分隔数字且命中 options → 换成选项文本。
 */
export function applyAskReply(
  text: string,
  pending: LarkPendingAsk[],
  resolveAsk: (askId: string, answer: string) => boolean,
  locale: MainLocale = "zh-CN",
): AskReplyResult {
  if (!pending.length) {
    return { reply: mainT(locale, "lark.reply.noPending"), resolvedAskIds: [], invalidAskIds: [] };
  }

  let entry: LarkPendingAsk | undefined;
  let answer = text.trim();

  if (pending.length > 1) {
    const match = /^#(\d+)[\s:：]*([\s\S]*)$/.exec(answer);
    if (!match) {
      return {
        reply: [
          mainT(locale, "lark.reply.multiPending", { count: pending.length }),
          ...pending.map((item) => `#${item.seq} ${truncateText(item.question.question, 60)}`),
        ].join("\n"),
        resolvedAskIds: [],
        invalidAskIds: [],
      };
    }
    const seq = Number(match[1] ?? "0");
    entry = pending.find((item) => item.seq === seq);
    if (!entry) {
      return {
        reply: [
          mainT(locale, "lark.reply.unknownSeq", { seq }),
          ...pending.map((item) => `#${item.seq} ${truncateText(item.question.question, 60)}`),
        ].join("\n"),
        resolvedAskIds: [],
        invalidAskIds: [],
      };
    }
    answer = (match[2] ?? "").trim();
    if (!answer) {
      // 只回 #N：等价于用序号本身作答案，走下面的选项编号映射
      answer = String(seq);
    }
  } else {
    entry = pending[0];
  }

  if (!entry) {
    return { reply: mainT(locale, "lark.reply.noPending"), resolvedAskIds: [], invalidAskIds: [] };
  }

  const mapped = mapOptionAnswer(answer, entry.question.options);
  const finalAnswer = mapped ?? answer;
  if (resolveAsk(entry.askId, finalAnswer)) {
    return {
      reply: mainT(locale, "lark.reply.answered", {
        question: truncateText(entry.question.question, 80),
      }),
      resolvedAskIds: [entry.askId],
      invalidAskIds: [],
    };
  }
  return {
    reply: mainT(locale, "lark.reply.invalid", {
      question: truncateText(entry.question.question, 80),
    }),
    resolvedAskIds: [],
    invalidAskIds: [entry.askId],
  };
}

// ---------- 纯逻辑：卡片交互回调（card.action.trigger）解析 ----------

/** card.action.trigger 事件行的所需字段（lark-cli 扁平 NDJSON） */
export interface LarkCardActionRecord {
  eventId: string;
  operatorId: string;
  messageId: string;
  chatId: string;
  actionTag: string;
  /** 触发组件的 name 属性（form 内按钮靠它区分 确认 btn_ok / 取消 btn_cancel） */
  actionName: string;
  /** 按钮 behaviors.value 回传（开发者定义的 value，JSON 字符串） */
  actionValue: string;
  /** select_static 单选选中项 value */
  option: string;
  /** multi_select_static 勾选值（逗号分隔字符串形态） */
  options: string;
  /** form 提交时各组件按 name 映射的 JSON 字符串 */
  formValue: string;
  /** 卡片延迟更新 token（30 分钟有效、最多 2 次）；缺失为空串 */
  token: string;
  /** 触发时的卡片 userDSL 原文（JSON 字符串）；缺失为空串 */
  cardContent: string;
}

/** 单行回调 NDJSON → 记录；空行/坏 JSON/缺 event_id 返回 null */
export function parseCardActionLine(line: string): LarkCardActionRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const str = (key: string): string => (typeof obj[key] === "string" ? (obj[key] as string) : "");
  // event_id 是去重键，缺失的行不可安全处理
  const eventId = str("event_id");
  if (!eventId) {
    return null;
  }
  return {
    eventId,
    operatorId: str("operator_id"),
    messageId: str("message_id"),
    chatId: str("chat_id"),
    actionTag: str("action_tag"),
    actionName: str("action_name"),
    actionValue: str("action_value"),
    option: str("option"),
    options: str("options"),
    formValue: str("form_value"),
    token: str("token"),
    cardContent: str("card_content"),
  };
}

/** 卡片回调解析出的问询动作 */
export interface CardAskAction {
  /** answer=提交答案；cancel=取消在飞书回答（问询仍可在 Zen 内回答） */
  kind: "answer" | "cancel";
  askId: string;
  seq: number;
  /** 组装好的答案文本（多选顿号拼接；选择+输入并存时以「；」连接）；cancel 时空串 */
  answer: string;
  /** true = 确认时既未选择也未输入（提示用户补全，不写回） */
  empty: boolean;
}

/** form_value / options 字段里可能出现的多值形态 → 字符串列表 */
function toStringList(raw: unknown): string[] {
  const segments = Array.isArray(raw) ? raw : [raw];
  const values: string[] = [];
  for (const segment of segments) {
    if (typeof segment !== "string") {
      continue;
    }
    for (const part of segment.split(/[,，]/)) {
      const piece = part.trim();
      if (piece) {
        values.push(piece);
      }
    }
  }
  return values;
}

/**
 * 卡片回调 → 问询动作：
 * - form 提交按钮（action_name=btn_ok/btn_cancel）：form_value.pick（单选/多选）
 *   + form_value.text（自定义输入）组装答案；askId 优先取 action_value，缺失由
 *   调用方用 message_id 映射兜底；
 * - 独立回调按钮（action_value 为 ask 载荷）：直接取答案（兼容旧卡片/测试卡）；
 * - 独立 select_static / multi_select_static：option(s) 为答案；
 * - 其他 tag 忽略。
 */
export function extractCardAskAction(
  record: LarkCardActionRecord,
  fallback?: { askId: string; seq: number },
): CardAskAction | null {
  if (record.actionTag !== "button" && record.actionTag !== "select_static" && record.actionTag !== "multi_select_static") {
    return null;
  }

  // 独立 select（未在 form 内提交）：option/options 即选项文本
  if (record.actionTag === "select_static" && record.option) {
    const value = parseAskActionValue(record.option);
    const askId = value?.askId || fallback?.askId || "";
    const seq = value?.seq ?? fallback?.seq ?? 0;
    if (value?.a) {
      return { kind: "answer", askId, seq, answer: value.a, empty: false };
    }
    return { kind: "answer", askId, seq, answer: record.option, empty: false };
  }
  if (record.actionTag === "multi_select_static" && record.options) {
    const values = toStringList(record.options).map(
      (item) => parseAskActionValue(item)?.a ?? item,
    );
    const first = parseAskActionValue(toStringList(record.options)[0] ?? "");
    return {
      kind: "answer",
      askId: first?.askId || fallback?.askId || "",
      seq: first?.seq ?? fallback?.seq ?? 0,
      answer: values.join("、"),
      empty: false,
    };
  }
  if (record.actionTag !== "button") {
    return null;
  }

  // form 提交按钮：优先 action_value（若按钮带回调值），否则走 form_value 组装
  const buttonValue = record.actionValue ? parseAskActionValue(record.actionValue) : null;
  if (buttonValue?.a) {
    return {
      kind: "answer",
      askId: buttonValue.askId,
      seq: buttonValue.seq,
      answer: buttonValue.a,
      empty: false,
    };
  }

  if (record.actionName === "btn_cancel") {
    return {
      kind: "cancel",
      askId: buttonValue?.askId || fallback?.askId || "",
      seq: buttonValue?.seq ?? fallback?.seq ?? 0,
      answer: "",
      empty: false,
    };
  }

  if (!record.formValue) {
    return null;
  }
  let form: unknown;
  try {
    form = JSON.parse(record.formValue);
  } catch {
    return null;
  }
  if (!isPlainObject(form)) {
    return null;
  }
  const askId = buttonValue?.askId || fallback?.askId || "";
  const seq = buttonValue?.seq ?? fallback?.seq ?? 0;
  if (record.actionName === "btn_ok" || !record.actionName) {
    const picks = toStringList(form.pick).map((item) => parseAskActionValue(item)?.a ?? item);
    const text = typeof form.text === "string" ? form.text.trim() : "";
    const answer = [picks.join("、"), text].filter(Boolean).join("；");
    return { kind: "answer", askId, seq, answer, empty: !answer };
  }
  return null;
}

// ---------- 进程管理薄封装（测试通过 deps 注入替身，不打真实网络） ----------

/** 飞书「对话」启动结果（与 agent-runner 的 startLarkChat 返回结构一致） */
export interface LarkChatStartResult {
  ok: boolean;
  sessionId?: string;
  title?: string;
  error?: string;
  /** 失败原因分类：missing=会话不存在/已归档（可回退新建）；busy=会话正在运行 */
  reason?: "missing" | "busy";
}

export interface LarkGatewayDeps {
  /** 会话清单（含运行状态映射后的摘要）；limit 控制条数 */
  listSessions: (limit: number) => LarkSessionSummary[];
  /** 答案写回：遍历主进程 sessions Map 调 session.resolveAsk */
  resolveAsk: (askId: string, answer: string) => boolean;
  /** 状态变化通知（ipc 层广播 lark:changed） */
  onStateChange: () => void;
  /** 项目清单（「项目」指令与项目名匹配的数据源） */
  listProjects?: () => LarkProjectSummary[];
  /** 「对话」指令：按项目路径找到/新建工作区，新建会话并异步运行 agent；路径为 null 时在公共区建会话 */
  startChat?: (workspacePath: string | null, message: string) => Promise<LarkChatStartResult>;
  /** 「继续」/普通文本续聊：向当前绑定会话追加消息（历史从 workspace-db 读取） */
  continueChat?: (sessionId: string, message: string) => Promise<LarkChatStartResult>;
  /** 「分支」指令：默认走 git-ops（30s 超时 + 输出截断） */
  listBranches?: (projectPath: string) => Promise<BranchListResult>;
  /** 「切换」指令：默认走 git-ops（脏工作区拒绝） */
  checkoutBranch?: (projectPath: string, branch: string) => Promise<CheckoutResult>;
  /** 「提交」指令：默认走 git-ops（add -A + commit） */
  commitProject?: (projectPath: string, message: string) => Promise<CommitResult>;
  /** 飞书会话 done 后读取最终助手回复（做完成推送摘要） */
  finalAssistantReply?: (sessionId: string) => string | null;
  /** 替身注入点：默认 spawn lark-cli event consume（eventKey 区分消息/卡片回调两个常驻通道） */
  spawnEvents?: (cliPath: string, eventKey: string) => import("node:child_process").ChildProcess;
  /** 替身注入点：默认 execFile im +messages-send；cardJson 非空时走 interactive 卡片；返回 message_id */
  sendMessage?: (
    cliPath: string,
    /** 接收者 open_id（主通道是绑定的操控者；无权限提示发给事件发送者） */
    openId: string,
    markdown: string,
    cardJson: string | undefined,
    idempotencyKey: string,
  ) => Promise<string | null>;
  /** 替身注入点：默认 lark-cli api POST /open-apis/interactive/v1/card/update（卡片延迟更新） */
  updateCard?: (cliPath: string, token: string, cardJson: string) => Promise<void>;
  /** 快捷命令落库（飞书内「添加/删除快捷命令」用；ipc 层写 settings 并广播） */
  saveQuickCommands?: (commands: LarkQuickCommand[]) => Promise<void>;
  /** 替身注入点：默认 bridge-lock 文件锁（跨进程单实例，防重复处理事件） */
  acquireLock?: () => LarkBridgeLockResult;
  releaseLock?: () => void;
}

const READY_MARKER = "[event] ready event_key=";
const RESTART_DELAY_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_SEND_LENGTH = 4000;

/** 两个常驻事件消费通道（消息指令 / 卡片交互回调） */
type LarkEventChannel = "messages" | "cardActions";

const EVENT_KEYS: Record<LarkEventChannel, string> = {
  messages: "im.message.receive_v1",
  cardActions: "card.action.trigger",
};

/** 单个消费通道的子进程与重试状态 */
interface ChannelState {
  child: import("node:child_process").ChildProcess | null;
  stdoutBuffer: string;
  stderrTail: string[];
  consecutiveFailures: number;
  restartTimer: NodeJS.Timeout | null;
  /** 配置类永久错误（如事件未在开放平台订阅）：不再重试，直接转 error 态 */
  permanentError: string | null;
}

function clampSendText(text: string, locale: MainLocale = "zh-CN"): string {
  if (text.length <= MAX_SEND_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_SEND_LENGTH - 6)}\n${mainT(locale, "lark.err.truncated")}`;
}

/**
 * stderr 行命中「事件回调未在开放平台订阅」（CLI validation/failed_precondition，
 * 进程固定 code=2 退出）→ 返回面向用户的永久性错误提示；其他行返回 null。
 * eventKey 需与通道一致，防两通道 stderr 串扰。
 */
export function eventNotSubscribedError(
  line: string,
  eventKey: string,
  locale: MainLocale = "zh-CN",
): string | null {
  const match = /EventKey (\S+) requires callbacks not subscribed/.exec(line);
  if (!match || match[1] !== eventKey) {
    return null;
  }
  return mainT(locale, "lark.err.notSubscribed", { eventKey });
}

function defaultSpawnEvents(cliPath: string, eventKey: string): import("node:child_process").ChildProcess {
  // stdin 保持打开不写入不 end：lark-cli event consume 靠 stdin 存活维持长连接
  return spawn(cliPath, ["event", "consume", eventKey, "--as", "bot"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function defaultSendMessage(
  cliPath: string,
  openId: string,
  markdown: string,
  cardJson: string | undefined,
  idempotencyKey: string,
): Promise<string | null> {
  // execFile 不经 shell：markdown/卡片 JSON 里的特殊字符不会被 shell 解释
  const args = ["im", "+messages-send", "--as", "bot", "--user-id", openId];
  if (cardJson) {
    args.push("--msg-type", "interactive", "--content", cardJson);
  } else {
    args.push("--markdown", markdown);
  }
  args.push("--idempotency-key", idempotencyKey);
  const { stdout } = await execFileAsync(cliPath, args, { timeout: 15_000 });
  // stdout 是 CLI 结果 JSON（{ok, data:{message_id}}）：解析出 message_id 供
  // 问询卡片回调定位归属（form 按钮不携带回调值，必须靠 message_id 映射）
  try {
    const parsed: unknown = JSON.parse(String(stdout));
    const messageId =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? ((parsed as Record<string, unknown>).data as Record<string, unknown> | undefined)
            ?.message_id
        : undefined;
    return typeof messageId === "string" ? messageId : null;
  } catch {
    return null;
  }
}

/** 卡片延迟更新（card.action.trigger 自带 token，30 分钟有效、最多 2 次）：整体替换卡片 */
async function defaultUpdateCard(cliPath: string, token: string, cardJson: string): Promise<void> {
  const data = JSON.stringify({ token, card: JSON.parse(cardJson) as unknown });
  await execFileAsync(
    cliPath,
    ["api", "POST", "/open-apis/interactive/v1/card/update", "--as", "bot", "--data", data],
    { timeout: 15_000 },
  );
}

/**
 * 发送失败通知摘要：丢掉 execFile 错误里的整条命令行（含卡片 JSON dump），
 * 只留截断 200 字的错误信息 + Feishu log_id 一行；原始细节由调用方 console.warn。
 */
export function summarizeSendError(detail: string, locale: MainLocale = "zh-CN"): string {
  const logId = /\blog_id["']?\s*[:=]\s*"?([A-Za-z0-9_-]+)/i.exec(detail)?.[1];
  const body = detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^command failed/i.test(line) && !/^\s*at\s+/.test(line))
    .join(" ");
  const summary = truncateText(body || mainT(locale, "lark.err.sendFailed"), 200);
  return logId ? `${summary}\nlog_id: ${logId}` : summary;
}

export class LarkGateway {
  private state: LarkGatewayState = "off";
  private gatewayError: string | null = null;
  private cliPath: string | null = null;
  private allowedOpenId: string | null = null;
  private stopping = false;
  /** 用户可见文案的当前语言（start 时读设置一次；读取失败回落 zh-CN） */
  private locale: MainLocale = "zh-CN";
  /** 两个常驻消费通道的状态（messages / cardActions），按 channel 懒初始化 */
  private readonly channels = new Map<LarkEventChannel, ChannelState>();
  /** askId → 待答问询 */
  private readonly pendingAsks = new Map<string, LarkPendingAsk>();
  /** 问询卡片 message_id → askId（form 按钮不携带回调值，靠它定位归属） */
  private readonly askByMessageId = new Map<string, string>();
  /** 本网关刚写回的 askId（ask_resolved 事件到达时不重复提示） */
  private readonly selfResolved = new Set<string>();
  private askSeq = 0;
  private lastSendError: string | null = null;
  private readonly deduper = new LarkMessageDeduper();
  /** 卡片回调 event_id 独立去重表 */
  private readonly cardActionDeduper = new LarkMessageDeduper();
  /** 飞书「对话」启动的会话（sessionId → 标题）：done 时推送最终回复摘要 */
  private readonly larkSessions = new Map<string, string>();
  /** 当前绑定会话（普通文本/「继续」追加到这里）；done 不解绑，归档/删除后由续聊失败回退新建 */
  private currentSessionId: string | null = null;
  private currentSessionTitle = "";
  /** 自定义快捷命令（设置变更实时生效） */
  private quickCommands: LarkQuickCommand[] = [];
  private lockHeld = false;
  /** 锁被其他实例占用（ipc 层据此定时重试：持锁实例退出后自动接管） */
  private lockBlocked = false;

  constructor(private readonly deps: LarkGatewayDeps) {}

  snapshot(): { state: LarkGatewayState; gatewayError: string | null; lockBlocked: boolean } {
    return { state: this.state, gatewayError: this.gatewayError, lockBlocked: this.lockBlocked };
  }

  /**
   * 启动事件网关（enabled 时由 ipc 层调用；重复调用幂等）。
   * allowedOpenId 变更无需重启子进程：事件过滤实时读最新值。
   */
  async start(settings: {
    allowedOpenId: string | null;
    quickCommands?: LarkQuickCommand[];
  }): Promise<void> {
    this.allowedOpenId = settings.allowedOpenId;
    // 快捷命令变更无需重启子进程：指令解析实时读最新值
    this.quickCommands = settings.quickCommands ?? [];
    // 文案语言随启动读一次设置（读取失败回落 zh-CN）
    this.locale = await currentLocale();
    if (this.state === "starting" || this.state === "ready") {
      return;
    }
    this.stopping = false;
    for (const channel of this.channels.values()) {
      channel.consecutiveFailures = 0;
    }
    // 先抢跨进程单实例锁：lark-cli event bus 会把事件广播给所有 consumer，
    // 多实例同时消费会重复处理同一条消息（默认 bridge-lock，测试注入替身）
    const lock = (this.deps.acquireLock ?? acquireLarkBridgeLock)();
    if (!lock.ok) {
      this.lockBlocked = true;
      this.setState(
        "error",
        mainT(this.locale, "lark.lockOccupied", {
          pid: lock.holderPid ?? mainT(this.locale, "lark.lockUnknownPid"),
        }),
      );
      return;
    }
    this.lockBlocked = false;
    this.lockHeld = true;
    this.cliPath = resolveLarkCliPath();
    if (!this.cliPath) {
      this.releaseBridgeLock();
      this.setState("error", mainT(this.locale, "lark.err.cliNotFound"));
      return;
    }
    const auth = await readLarkAuthSnapshot();
    if (!auth.available) {
      this.releaseBridgeLock();
      this.setState(
        "error",
        mainT(this.locale, "lark.err.cliUnavailable", {
          reason: auth.error ?? mainT(this.locale, "lark.err.unknownReason"),
        }),
      );
      return;
    }
    if (!auth.botReady) {
      this.releaseBridgeLock();
      this.setState("error", mainT(this.locale, "lark.err.botNotReady"));
      return;
    }
    this.spawnAll();
  }

  /** 停止：两个消费通道都 SIGTERM 优雅退出（不 kill -9），清重启定时器并释放单实例锁 */
  stop(): void {
    this.stopping = true;
    for (const channel of this.channels.values()) {
      if (channel.restartTimer) {
        clearTimeout(channel.restartTimer);
        channel.restartTimer = null;
      }
      const child = channel.child;
      channel.child = null;
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
    this.releaseBridgeLock();
    this.setState("off", null);
  }

  private releaseBridgeLock(): void {
    if (!this.lockHeld) {
      return;
    }
    this.lockHeld = false;
    (this.deps.releaseLock ?? releaseLarkBridgeLock)();
  }

  /** askUser 问询推送（同一 askId 不重复推送；网关关闭时静默丢弃） */
  pushAsk(question: AskUserQuestionEvent, sessionId: string, sessionTitle: string): void {
    if (this.state === "off" || this.pendingAsks.has(question.askId)) {
      return;
    }
    this.askSeq += 1;
    const entry: LarkPendingAsk = {
      askId: question.askId,
      sessionId,
      sessionTitle,
      seq: this.askSeq,
      question,
    };
    this.pendingAsks.set(question.askId, entry);
    void this.sendReply(
      buildAskPushText(entry, this.pendingAsks.size, this.locale),
      buildAskPushCard(entry, this.pendingAsks.size, this.locale),
    ).then((messageId) => {
      // 回填 message_id：表单式卡片的按钮不携带回调值，回调按它定位问询
      if (messageId) {
        entry.messageId = messageId;
        this.askByMessageId.set(messageId, entry.askId);
      }
    });
  }

  /** 待答问询清理（含 message_id 映射） */
  private dropPendingAsk(askId: string): LarkPendingAsk | undefined {
    const entry = this.pendingAsks.get(askId);
    this.pendingAsks.delete(askId);
    this.selfResolved.delete(askId);
    if (entry?.messageId) {
      this.askByMessageId.delete(entry.messageId);
    }
    return entry;
  }

  /** ask_resolved 事件（含非飞书渠道回答）：移除待答；非本网关写回的补一条提示 */
  onAskResolved(askId: string): void {
    if (!this.pendingAsks.has(askId)) {
      return;
    }
    this.dropPendingAsk(askId);
    if (this.selfResolved.has(askId)) {
      return;
    }
    void this.sendReply(mainT(this.locale, "lark.ask.resolvedElsewhere"));
  }

  /** 「对话」/续聊启动成功后登记会话：done 时推送最终回复摘要，并绑定为当前续聊会话 */
  trackSession(sessionId: string, title: string): void {
    this.larkSessions.set(sessionId, title);
    this.currentSessionId = sessionId;
    this.currentSessionTitle = title;
  }

  /** 会话 done：清理该会话全部待答（问询随 run 终结，不再可回答） */
  onSessionDone(sessionId: string): void {
    for (const [askId, entry] of this.pendingAsks) {
      if (entry.sessionId === sessionId) {
        this.dropPendingAsk(askId);
      }
    }
    const title = this.larkSessions.get(sessionId);
    if (!title) {
      return;
    }
    this.larkSessions.delete(sessionId);
    // emitTo 先喂网关再同步落库（persistRun），微任务里最终助手消息已持久化
    queueMicrotask(() => {
      const reply =
        this.deps.finalAssistantReply?.(sessionId)?.trim() ||
        mainT(this.locale, "lark.session.noReply");
      void this.sendReply(
        mainT(this.locale, "lark.session.donePush", {
          title,
          reply: truncateText(reply, 800),
        }),
        buildSessionDoneCard(title, reply, this.locale),
      );
    });
  }

  /** 「状态」指令用：某会话首个待答问询的 question 文本 */
  firstPendingQuestion(sessionId: string): string | null {
    for (const entry of this.pendingAsks.values()) {
      if (entry.sessionId === sessionId) {
        return entry.question.question;
      }
    }
    return null;
  }

  private setState(state: LarkGatewayState, error: string | null): void {
    this.state = state;
    this.gatewayError = error;
    this.deps.onStateChange();
  }

  private channelOf(channel: LarkEventChannel): ChannelState {
    let state = this.channels.get(channel);
    if (!state) {
      state = {
        child: null,
        stdoutBuffer: "",
        stderrTail: [],
        consecutiveFailures: 0,
        restartTimer: null,
        permanentError: null,
      };
      this.channels.set(channel, state);
    }
    return state;
  }

  /** 拉起全部消费通道（messages 指令通道 + card.action.trigger 卡片回调通道） */
  private spawnAll(): void {
    if (!this.cliPath) {
      return;
    }
    this.setState("starting", null);
    this.spawnConsumer("messages");
    this.spawnConsumer("cardActions");
  }

  private spawnConsumer(channel: LarkEventChannel): void {
    if (!this.cliPath) {
      return;
    }
    const state = this.channelOf(channel);
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    state.stdoutBuffer = "";
    state.stderrTail = [];
    state.permanentError = null;
    let settled = false;
    let child: import("node:child_process").ChildProcess;
    try {
      child = (this.deps.spawnEvents ?? defaultSpawnEvents)(this.cliPath, EVENT_KEYS[channel]);
    } catch (error) {
      this.handleUnexpectedExit(channel, error instanceof Error ? error.message : String(error));
      return;
    }
    state.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.onStdoutChunk(channel, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      this.onStderrChunk(channel, chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      state.child = null;
      this.handleUnexpectedExit(channel, error.message);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      state.child = null;
      if (this.stopping) {
        // 主动 stop 已把状态置 off，不再重复广播
        return;
      }
      this.handleUnexpectedExit(
        channel,
        signal
          ? mainT(this.locale, "lark.err.killedBySignal", { signal })
          : mainT(this.locale, "lark.err.exited", { code: code ?? "null" }),
      );
    });
  }

  private onStdoutChunk(channel: LarkEventChannel, chunk: string): void {
    const state = this.channelOf(channel);
    state.stdoutBuffer += chunk;
    let index = state.stdoutBuffer.indexOf("\n");
    while (index >= 0) {
      const line = state.stdoutBuffer.slice(0, index);
      state.stdoutBuffer = state.stdoutBuffer.slice(index + 1);
      if (channel === "messages") {
        this.handleEventLine(line);
      } else {
        this.handleCardActionLine(line);
      }
      index = state.stdoutBuffer.indexOf("\n");
    }
    // 异常超长半行（非 NDJSON 输出）直接丢弃，防内存膨胀
    if (state.stdoutBuffer.length > 1_000_000) {
      state.stdoutBuffer = "";
    }
  }

  private handleEventLine(line: string): void {
    const record = parseLarkEventLine(line);
    if (!record) {
      return;
    }
    if (!isHandleableLarkEvent(record, this.allowedOpenId)) {
      this.maybeReplyUnauthorized(record);
      return;
    }
    if (!this.deduper.firstSeen(record.messageId)) {
      return;
    }
    void this.handleText(record.content).catch((error) => {
      console.warn("[lark] 处理飞书消息失败:", error);
    });
  }

  /**
   * 操作鉴权：非绑定 open_id 的所有指令一律忽略；仅在「已锁定操控者 + 对方是
   * 用户身份的 p2p 文本私信」时回一句无权限提示（未配置操控者时保持静默，
   * 避免与任何陌生人产生交互；同一 message_id 去重防事件重投重复回复）。
   */
  private maybeReplyUnauthorized(record: LarkEventRecord): void {
    if (
      !this.allowedOpenId ||
      !record.senderId ||
      record.senderId === this.allowedOpenId ||
      record.senderType !== "user" ||
      record.messageType !== "text" ||
      record.chatType !== "p2p" ||
      !this.deduper.firstSeen(`unauth:${record.messageId}`)
    ) {
      return;
    }
    const recipient = record.senderId;
    void this.sendUnauthorizedReply(recipient).catch(() => undefined);
  }

  /** 非绑定用户的固定无权限提示（独立通道发送，失败静默不影响主通道状态） */
  private async sendUnauthorizedReply(recipientOpenId: string): Promise<void> {
    const cliPath = this.cliPath;
    if (!cliPath) {
      return;
    }
    try {
      await (this.deps.sendMessage ?? defaultSendMessage)(
        cliPath,
        recipientOpenId,
        mainT(this.locale, "lark.unauthorized"),
        undefined,
        randomUUID(),
      );
    } catch {
      // 提示发送失败直接忽略
    }
  }

  private onStderrChunk(channel: LarkEventChannel, chunk: string): void {
    const state = this.channelOf(channel);
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      // ready marker 自带 event_key，只认本通道的 ready，防两通道串扰
      if (trimmed.includes(READY_MARKER) && trimmed.includes(EVENT_KEYS[channel])) {
        state.consecutiveFailures = 0;
        const permanent = this.activePermanentError();
        // 恢复 ready 时保留其他通道的永久性错误提示（如卡片回调未订阅）
        if (this.state !== "ready" || this.gatewayError !== permanent) {
          this.setState("ready", permanent);
        }
        continue;
      }
      const notSubscribed = eventNotSubscribedError(trimmed, EVENT_KEYS[channel], this.locale);
      if (notSubscribed) {
        state.permanentError = notSubscribed;
      }
      state.stderrTail.push(trimmed);
      if (state.stderrTail.length > 20) {
        state.stderrTail.shift();
      }
    }
  }

  /** 任一通道的永久性配置错误（如事件未订阅）：messages 通道仍可用，但提示保持可见 */
  private activePermanentError(): string | null {
    for (const state of this.channels.values()) {
      if (state.permanentError) {
        return state.permanentError;
      }
    }
    return null;
  }

  /** 非主动 stop 的退出：永久性配置错误直接转 error 态；否则 5s 退避重启该通道，连续失败达上限转 error 态停止重启 */
  private handleUnexpectedExit(channel: LarkEventChannel, reason: string): void {
    const state = this.channelOf(channel);
    if (state.permanentError) {
      this.setState("error", state.permanentError);
      return;
    }
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const tail = state.stderrTail.slice(-5).join(" | ");
      this.setState(
        "error",
        mainT(this.locale, "lark.err.consecutiveFailures", {
          count: state.consecutiveFailures,
          reason,
        }) + (tail ? `：${tail}` : ""),
      );
      return;
    }
    this.setState(
      "starting",
      mainT(this.locale, "lark.err.restartDelay", {
        reason,
        seconds: RESTART_DELAY_MS / 1000,
      }),
    );
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      if (this.stopping) {
        return;
      }
      this.spawnConsumer(channel);
    }, RESTART_DELAY_MS);
  }

  /** card.action.trigger 通道：event_id 去重 → operator 鉴权（非白名单静默）→ 分发动作 */
  private handleCardActionLine(line: string): void {
    const record = parseCardActionLine(line);
    if (!record) {
      return;
    }
    if (!this.cardActionDeduper.firstSeen(record.eventId)) {
      return;
    }
    if (!this.allowedOpenId || record.operatorId !== this.allowedOpenId) {
      return;
    }
    // 表单按钮不携带回调值：按卡片 message_id 映射兜底定位问询
    const mappedAskId = this.askByMessageId.get(record.messageId);
    const mappedEntry = mappedAskId ? this.pendingAsks.get(mappedAskId) : undefined;
    const fallback = mappedEntry ? { askId: mappedEntry.askId, seq: mappedEntry.seq } : undefined;
    const action = extractCardAskAction(record, fallback);
    if (action && (action.kind === "cancel" || !action.empty)) {
      void this.applyCardAskAction(action, record.token).catch((error) => {
        console.warn("[lark] 处理卡片回调失败:", error);
      });
      return;
    }
    if (action?.empty) {
      // 确认时既未选择也未输入：提示补全（不写回）
      void this.sendReply(
        mappedEntry
          ? mainT(this.locale, "lark.ask.emptyReply", {
              question: truncateText(mappedEntry.question.question, 60),
            })
          : mainT(this.locale, "lark.ask.emptyReplyBare"),
      );
      return;
    }
    // 菜单卡片按钮：等价于用户直接输入指令/快捷命令文本
    const command = extractCardCommand(record);
    if (command) {
      void this.handleText(command).catch((error) => {
        console.warn("[lark] 处理卡片指令按钮失败:", error);
      });
    }
  }

  /**
   * 卡片问询动作落地：
   * - cancel：更新卡片为「已取消」，移除待答（问询仍可在 Zen 内回答）并回执；
   * - answer：写回会话；成功后卡片替换为「已回答」，失败回失效提示。
   */
  private async applyCardAskAction(action: CardAskAction, token: string): Promise<void> {
    const entry = this.pendingAsks.get(action.askId);
    if (action.kind === "cancel") {
      if (entry) {
        this.dropPendingAsk(action.askId);
        await this.updateCardQuietly(token, buildAskCancelledCard(entry, this.locale));
        await this.sendReply(
          mainT(this.locale, "lark.ask.cancelledReply", {
            question: truncateText(entry.question.question, 80),
          }),
        );
        return;
      }
      await this.sendReply(mainT(this.locale, "lark.reply.invalidBare"));
      return;
    }
    if (this.deps.resolveAsk(action.askId, action.answer)) {
      if (entry) {
        this.dropPendingAsk(action.askId);
        this.selfResolved.add(action.askId);
        await this.updateCardQuietly(token, buildAskAnsweredCard(entry, action.answer, this.locale));
      }
      await this.sendReply(
        entry
          ? mainT(this.locale, "lark.reply.answered", {
              question: truncateText(entry.question.question, 80),
            })
          : mainT(this.locale, "lark.answer.okBare"),
      );
      return;
    }
    this.dropPendingAsk(action.askId);
    await this.sendReply(
      entry
        ? mainT(this.locale, "lark.reply.invalid", {
            question: truncateText(entry.question.question, 80),
          })
        : mainT(this.locale, "lark.reply.invalidBare"),
    );
  }

  /** 卡片延迟更新（token 30 分钟有效、最多 2 次）：失败只记日志，不影响写回与回执 */
  private async updateCardQuietly(token: string, card: LarkCard2): Promise<void> {
    if (!token || !this.cliPath) {
      return;
    }
    try {
      await (this.deps.updateCard ?? defaultUpdateCard)(this.cliPath, token, JSON.stringify(card));
    } catch (error) {
      console.warn("[lark] 卡片延迟更新失败:", error instanceof Error ? error.message : error);
    }
  }

  /** 指令回复：有待答问询被指令打断时，末尾提醒剩余待答数量 */
  private async sendCommandReply(text: string, card?: LarkCard | LarkCard2): Promise<void> {
    const count = this.pendingAsks.size;
    const reminder = count
      ? `\n${mainT(this.locale, "lark.cmd.pendingReminder", { count })}`
      : "";
    await this.sendReply(text + reminder, card);
  }

  private async handleText(text: string): Promise<void> {
    // ① 指令随时可用（打断问询时在回复末尾提醒）；② 非指令文本优先回答待答问询；
    // ③ 无待答时续聊当前绑定会话；④ 无绑定会话才新建
    const command = parseLarkCommand(text);
    if (command === "sessions") {
      await this.sendCommandReply(
        buildSessionsReply(this.deps.listSessions(10), Date.now(), this.locale),
      );
      return;
    }
    if (command === "status") {
      await this.sendCommandReply(
        buildStatusReply(
          this.deps.listSessions(50),
          (sessionId) => this.firstPendingQuestion(sessionId),
          Date.now(),
          this.locale,
        ),
      );
      return;
    }
    if (command === "help") {
      await this.sendCommandReply(
        buildHelpReply(this.quickCommands, this.locale),
        buildMenuCard(this.quickCommands, this.locale),
      );
      return;
    }
    if (command === "projects") {
      await this.sendCommandReply(
        buildProjectsReply(this.deps.listProjects?.() ?? [], Date.now(), this.locale),
        buildListCard({
          title: mainT(this.locale, "lark.projects.header"),
          template: "wathet",
          emptyText: mainT(this.locale, "lark.projects.empty"),
          items: (this.deps.listProjects?.() ?? []).map((project) => ({
            title: `**${project.name}**`,
            subtitle: `<font color='grey'>${project.path} · ${formatRelativeTime(project.lastActiveAt, Date.now(), this.locale)}</font>`,
          })),
        }),
      );
      return;
    }
    if (command === "quick") {
      await this.sendCommandReply(
        [mainT(this.locale, "lark.quick.header"), ...buildQuickCommandLines(this.quickCommands, this.locale)].join("\n") ||
          mainT(this.locale, "lark.quick.cardEmpty"),
        buildQuickManageCard(this.quickCommands, this.locale),
      );
      return;
    }
    const quickManage = parseQuickManageCommand(text);
    if (quickManage) {
      await this.handleQuickManage(quickManage);
      return;
    }
    const projectCommand = parseProjectCommand(text);
    if (projectCommand) {
      const reply = await this.handleProjectCommand(projectCommand);
      // null = 「对话」/「新会话」/「继续」已自行发送回执，无需补发
      if (reply !== null) {
        await this.sendCommandReply(reply);
      }
      return;
    }
    // /别名 快捷命令：展开为预设文本后走同一管线（可命中内置指令或作为消息启动/续聊）
    const quick = parseQuickCommand(text);
    if (quick) {
      await this.handleQuickCommand(quick);
      return;
    }
    const pending = [...this.pendingAsks.values()];
    if (pending.length) {
      const result = applyAskReply(text, pending, this.deps.resolveAsk, this.locale);
      for (const askId of result.resolvedAskIds) {
        this.pendingAsks.delete(askId);
        this.selfResolved.add(askId);
      }
      for (const askId of result.invalidAskIds) {
        this.pendingAsks.delete(askId);
      }
      await this.sendReply(result.reply);
      return;
    }
    await this.handlePlainMessage(text.trim(), false);
  }

  /**
   * 自定义快捷命令执行：/别名 → 展开 prompt（支持 $1 占位或追加附加文本），
   * 展开结果若命中内置指令直接执行，否则按普通消息启动/续聊会话。
   */
  private async handleQuickCommand(quick: ParsedQuickCommand): Promise<void> {
    const hit = this.quickCommands.find((item) => item.alias.trim().toLowerCase() === quick.alias);
    if (!hit) {
      const known = this.quickCommands.map((item) => `/${item.alias}`).join("、");
      await this.sendCommandReply(
        known
          ? mainT(this.locale, "lark.quick.unknown", { alias: quick.alias, known })
          : mainT(this.locale, "lark.quick.noneConfigured", { alias: quick.alias }),
      );
      return;
    }
    const expanded = expandQuickCommand(hit.prompt, quick.arg);
    // 展开结果先按内置指令执行（如 prompt 为「状态」），否则作为消息走会话管线
    const command = parseLarkCommand(expanded);
    if (command) {
      await this.handleText(expanded);
      return;
    }
    await this.handlePlainMessage(expanded, false);
  }

  /**
   * 快捷命令管理指令执行（飞书内直接增删）：
   * - quick-add：校验别名/提示词 → 更新内存清单 → 落库（settings 广播给所有实例）→ 回管理卡片；
   * - quick-del：命中移除 → 落库 → 回管理卡片；未命中回提示。
   */
  private async handleQuickManage(cmd: ParsedQuickManageCommand): Promise<void> {
    const alias = cmd.alias.trim().toLowerCase();
    if (cmd.kind === "quick-add") {
      if (!alias || !cmd.prompt.trim()) {
        await this.sendCommandReply(mainT(this.locale, "lark.quick.usageAdd"));
        return;
      }
      if (!/^[^\s/]+$/.test(alias)) {
        await this.sendCommandReply(mainT(this.locale, "lark.quick.invalidAlias", { alias }));
        return;
      }
      const existing = this.quickCommands.find((item) => item.alias.toLowerCase() === alias);
      const entry: LarkQuickCommand = {
        id: existing?.id ?? `qc-${Date.now()}`,
        alias,
        label: existing?.label ?? alias,
        prompt: cmd.prompt.trim(),
      };
      const next = existing
        ? this.quickCommands.map((item) => (item.id === existing.id ? entry : item))
        : [...this.quickCommands, entry];
      try {
        await this.deps.saveQuickCommands?.(next);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await this.sendCommandReply(
          mainT(this.locale, "lark.quick.saveFailed", { error: truncateText(detail, 200) }),
        );
        return;
      }
      this.quickCommands = next;
      await this.sendCommandReply(
        existing
          ? mainT(this.locale, "lark.quick.updated", { alias })
          : mainT(this.locale, "lark.quick.added", { alias }),
        buildQuickManageCard(this.quickCommands, this.locale),
      );
      return;
    }
    // quick-del
    const hit = this.quickCommands.find((item) => item.alias.toLowerCase() === alias);
    if (!hit) {
      await this.sendCommandReply(mainT(this.locale, "lark.quick.notFound", { alias }));
      return;
    }
    const next = this.quickCommands.filter((item) => item.id !== hit.id);
    try {
      await this.deps.saveQuickCommands?.(next);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.sendCommandReply(
        mainT(this.locale, "lark.quick.saveFailed", { error: truncateText(detail, 200) }),
      );
      return;
    }
    this.quickCommands = next;
    await this.sendCommandReply(
      mainT(this.locale, "lark.quick.deleted", { alias }),
      buildQuickManageCard(this.quickCommands, this.locale),
    );
  }

  /** 非指令普通文本：续聊当前绑定会话（forceNew 跳过续聊直接新建）；绑定会话失效时回退新建 */
  private async handlePlainMessage(message: string, forceNew: boolean): Promise<void> {
    if (!forceNew && this.currentSessionId && this.deps.continueChat) {
      const result = await this.deps.continueChat(this.currentSessionId, message);
      if (result.ok) {
        await this.sendReply(
          mainT(this.locale, "lark.chat.continued", {
            title: result.title ?? this.currentSessionTitle,
            message: truncateText(message, 80),
            progress: mainT(this.locale, "lark.chat.progressNote"),
          }),
        );
        return;
      }
      if (result.reason !== "missing") {
        // busy 等：保留绑定，等运行结束后再续聊
        await this.sendReply(
          `❌ ${result.error ?? mainT(this.locale, "lark.chat.continueFailed")}`,
        );
        return;
      }
      // 会话已归档/删除：解绑并回退新建
      this.currentSessionId = null;
      this.currentSessionTitle = "";
    }
    if (!this.deps.startChat) {
      await this.sendReply(mainT(this.locale, "lark.chat.noStartChat"));
      return;
    }
    const hint = forceNew ? "" : `\n${mainT(this.locale, "lark.chat.newHint")}`;
    await this.sendReply(
      `${mainT(this.locale, "lark.chat.started", {
        message: truncateText(message, 80),
      })}${hint}\n${mainT(this.locale, "lark.chat.progressNote")}`,
    );
    const result = await this.deps.startChat(null, message);
    if (!result.ok) {
      await this.sendReply(
        mainT(this.locale, "lark.chat.startFailed", {
          error: result.error ?? mainT(this.locale, "lark.err.unknownReason"),
        }),
      );
    }
  }

  /** 带参数指令执行；返回要回复的文案，null 表示已自行发送回复 */
  private async handleProjectCommand(cmd: ParsedProjectCommand): Promise<string | null> {
    if (cmd.kind === "chat" && (!cmd.project || !cmd.arg)) {
      return buildProjectCommandUsage("chat", this.locale);
    }
    if (cmd.kind === "branches" && !cmd.project) {
      return buildProjectCommandUsage("branches", this.locale);
    }
    if (cmd.kind === "checkout" && (!cmd.project || !cmd.arg)) {
      return buildProjectCommandUsage("checkout", this.locale);
    }
    if (cmd.kind === "commit" && !cmd.project) {
      return buildProjectCommandUsage("commit", this.locale);
    }
    if ((cmd.kind === "new" || cmd.kind === "continue") && !cmd.arg) {
      return buildProjectCommandUsage(cmd.kind, this.locale);
    }
    if (cmd.kind === "new") {
      await this.handlePlainMessage(cmd.arg, true);
      return null;
    }
    if (cmd.kind === "continue") {
      if (!this.currentSessionId) {
        return mainT(this.locale, "lark.continue.noBinding");
      }
      await this.handlePlainMessage(cmd.arg, false);
      return null;
    }

    const projects = this.deps.listProjects?.() ?? [];
    const matches = matchProjectSummaries(cmd.project, projects);
    if (!matches.length) {
      return mainT(this.locale, "lark.project.notFound", {
        query: truncateText(cmd.project, 40),
        list: buildProjectsReply(projects, Date.now(), this.locale),
      });
    }
    if (matches.length > 1) {
      return buildProjectCandidatesReply(cmd.project, matches, Date.now(), this.locale);
    }
    const project = matches[0]!;
    if (!project.path) {
      return mainT(this.locale, "lark.project.noPath", { name: project.name });
    }

    if (cmd.kind === "chat") {
      if (!this.deps.startChat) {
        return mainT(this.locale, "lark.chat.noStartChat");
      }
      // 立即回执，不等 run 结束；运行状态走「状态」查询，完成后由网关推送摘要
      await this.sendReply(
        `${mainT(this.locale, "lark.chat.startedInProject", {
          name: project.name,
          message: truncateText(cmd.arg, 80),
        })}\n${mainT(this.locale, "lark.chat.progressNote")}`,
      );
      const result = await this.deps.startChat(project.path, cmd.arg);
      if (!result.ok) {
        await this.sendReply(
          mainT(this.locale, "lark.chat.startFailed", {
            error: result.error ?? mainT(this.locale, "lark.err.unknownReason"),
          }),
        );
      }
      return null;
    }

    if (cmd.kind === "branches") {
      try {
        const branches = await (this.deps.listBranches ?? defaultListBranches)(project.path);
        return buildBranchesReply(project, branches, this.locale);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return mainT(this.locale, "lark.branch.fetchFailed", {
          error: truncateText(message, 300),
        });
      }
    }

    if (cmd.kind === "checkout") {
      const result = await (this.deps.checkoutBranch ?? defaultCheckoutBranch)(
        project.path,
        cmd.arg,
      );
      if (result.ok) {
        return mainT(this.locale, "lark.checkout.ok", { branch: cmd.arg, project: project.name });
      }
      if (result.dirty) {
        return [
          mainT(this.locale, "lark.checkout.dirty1", { name: project.name }),
          mainT(this.locale, "lark.checkout.dirty2", { project: cmd.project }),
          "",
          truncateText(result.error ?? "", 500),
        ].join("\n");
      }
      return mainT(this.locale, "lark.checkout.failed", {
        error: result.error ?? mainT(this.locale, "lark.err.unknownReason"),
      });
    }

    // commit：缺省说明时用默认文案（提交信息尾部仍注明 via Zen/飞书）
    const result = await (this.deps.commitProject ?? defaultCommitAll)(
      project.path,
      cmd.arg || mainT(this.locale, "lark.commit.default"),
    );
    if (result.ok) {
      return mainT(this.locale, "lark.commit.ok", {
        project: project.name,
        summary: result.summary ?? "",
      });
    }
    if (result.clean) {
      return mainT(this.locale, "lark.commit.clean", { name: project.name });
    }
    return mainT(this.locale, "lark.commit.failed", {
      error: result.error ?? mainT(this.locale, "lark.err.unknownReason"),
    });
  }

  /** 指令回复发送；返回发出消息的 message_id（问询卡片靠它回填回调映射） */
  private async sendReply(text: string, card?: LarkCard | LarkCard2): Promise<string | null> {
    return await this.sendOutgoing(text, card);
  }

  async sendMarkdown(text: string): Promise<void> {
    await this.sendOutgoing(text);
  }

  /** 出站发送：优先卡片；序列化超长或上一次发送失败时降级为纯文本（失败提示前置） */
  private async sendOutgoing(markdown: string, card?: LarkCard | LarkCard2): Promise<string | null> {
    const notice = this.lastSendError;
    this.lastSendError = null;
    let cardJson: string | undefined;
    if (card && !notice) {
      const json = JSON.stringify(card);
      // 超出 CLI 单条消息长度上限：放弃卡片走纯文本（clampSendText 统一截断）
      cardJson = json.length <= MAX_SEND_LENGTH ? json : undefined;
    }
    const body = notice
      ? `${mainT(this.locale, "lark.send.prevFailed", { notice })}\n\n${markdown}`
      : markdown;
    return await this.sendOutgoingRaw(cardJson ? markdown : clampSendText(body, this.locale), cardJson);
  }

  private async sendOutgoingRaw(markdown: string, cardJson?: string): Promise<string | null> {
    const cliPath = this.cliPath;
    const openId = this.allowedOpenId;
    if (!cliPath || !openId) {
      // 未锁定允许的飞书用户时无处可发：记录原因，不抛错
      this.lastSendError =
        this.lastSendError ?? mainT(this.locale, "lark.send.noRecipient");
      return null;
    }
    try {
      return await (this.deps.sendMessage ?? defaultSendMessage)(
        cliPath,
        openId,
        markdown,
        cardJson,
        randomUUID(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 原始细节（含命令行/卡片 JSON）只进主进程日志，通知走短摘要
      console.warn("[lark] 飞书消息发送失败:", message);
      this.lastSendError = summarizeSendError(message, this.locale);
      return null;
    }
  }

  /** 发送测试问询卡片（设置页验证按钮回调）；假 askId，回调写回会回「该问询已失效」，属预期 */
  sendTestAskCard(): { ok: boolean; error?: string } {
    if (!this.cliPath || !this.allowedOpenId) {
      return { ok: false, error: mainT(this.locale, "lark.test.notEnabled") };
    }
    const entry: LarkPendingAsk = {
      askId: `test-${randomUUID()}`,
      sessionId: "",
      sessionTitle: mainT(this.locale, "lark.test.title"),
      seq: 0,
      question: {
        askId: `test-${randomUUID()}`,
        toolCallId: "test",
        question: mainT(this.locale, "lark.test.question"),
        options: [mainT(this.locale, "lark.test.optionA"), mainT(this.locale, "lark.test.optionB")],
        allowFreeText: true,
      },
    };
    entry.question.askId = entry.askId;
    // 不入 pendingAsks：测试卡片不占用真实问询回复路由
    void this.sendReply(
      buildAskPushText(entry, 1, this.locale),
      buildAskPushCard(entry, 1, this.locale),
    );
    return { ok: true };
  }
}
