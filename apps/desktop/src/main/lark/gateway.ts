import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type {
  AskUserQuestionEvent,
  LarkGatewayState,
  LarkProjectSummary,
  LarkSessionState,
  LarkSessionSummary,
  WorkspaceGroup,
} from "@zen/shared";

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

export const LARK_STATE_LABELS: Record<LarkSessionState, string> = {
  idle: "空闲",
  running: "运行中",
  "waiting-approval": "等待确认",
  "waiting-ask": "等待回答",
  paused: "已暂停",
};

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

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }
  return `${Math.floor(diff / day)} 天前`;
}

export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 「列表」指令回复 */
export function buildSessionsReply(summaries: LarkSessionSummary[], now = Date.now()): string {
  if (!summaries.length) {
    return "📋 Zen 会话：暂无未归档会话。";
  }
  const lines = summaries.map(
    (item, index) =>
      `${index + 1}. ${item.title} · ${LARK_STATE_LABELS[item.state]} · ${formatRelativeTime(item.updatedAt, now)}`,
  );
  return ["📋 Zen 会话（最近更新）", ...lines].join("\n");
}

/** 「状态」指令回复：只列非空闲会话，附首个待答问询（截断 80 字） */
export function buildStatusReply(
  summaries: LarkSessionSummary[],
  pendingQuestionOf: (sessionId: string) => string | null,
  now = Date.now(),
): string {
  const active = summaries.filter((item) => item.state !== "idle");
  if (!active.length) {
    return "📊 Zen 状态：当前没有运行中的会话。";
  }
  const lines = active.map((item, index) => {
    const base = `${index + 1}. ${item.title} · ${LARK_STATE_LABELS[item.state]} · ${formatRelativeTime(item.updatedAt, now)}`;
    const question = pendingQuestionOf(item.id);
    return question ? `${base}\n   ❓ ${truncateText(question, 80)}` : base;
  });
  return ["📊 Zen 运行中的会话", ...lines].join("\n");
}

/** 「帮助」指令回复 */
export function buildHelpReply(): string {
  return [
    "📖 Zen 指令",
    "• 列表 / sessions — 最近会话清单",
    "• 状态 / status — 运行中的会话与待答问询",
    "• 项目 / projects — 项目清单",
    "• 对话 <项目名> <消息> / chat — 在指定项目新建会话并运行",
    "• 分支 <项目名> / branches — 查看项目本地分支",
    "• 切换 <项目名> <分支名> / checkout — 切换分支（有未提交变更时拒绝）",
    "• 提交 <项目名> <说明> / commit — 提交项目全部变更",
    "• 帮助 / help — 本帮助",
    "收到问询推送时，直接回复文字或选项编号即可写回会话。",
  ].join("\n");
}

// ---------- 纯逻辑：项目/分支/提交指令解析与文案 ----------

export type LarkCommand = "sessions" | "status" | "help" | "projects";

/** 指令全等匹配（去空白、大小写不敏感）；非指令文本返回 null 走问询回复解析 */
export function parseLarkCommand(text: string): LarkCommand | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "列表" || normalized === "sessions") {
    return "sessions";
  }
  if (normalized === "状态" || normalized === "status") {
    return "status";
  }
  if (normalized === "帮助" || normalized === "help") {
    return "help";
  }
  if (normalized === "项目" || normalized === "projects") {
    return "projects";
  }
  return null;
}

/** 带参数指令（对话/分支/切换/提交）的解析结果 */
export interface ParsedProjectCommand {
  kind: "chat" | "branches" | "checkout" | "commit";
  /** 第一个参数（项目名，包含匹配）；缺失为 "" */
  project: string;
  /** 第二个参数（消息 / 分支名 / 提交说明）；缺失为 "" */
  arg: string;
}

/**
 * 带参数指令解析：第一个 token 是指令词（大小写不敏感），其余为参数。
 * - 对话 <项目> <消息> / chat <project> <message>
 * - 分支 <项目> / branches <project>（项目名取整段剩余文本，允许含空格）
 * - 切换 <项目> <分支> / checkout <project> <branch>
 * - 提交 <项目> <说明> / commit <project> <message>
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
export function buildProjectsReply(projects: LarkProjectSummary[], now = Date.now()): string {
  if (!projects.length) {
    return "📂 Zen 项目：暂无工作区。";
  }
  const lines = projects.map(
    (project, index) =>
      `${index + 1}. ${project.name} · ${project.path} · ${formatRelativeTime(project.lastActiveAt, now)}`,
  );
  return ["📂 Zen 项目", ...lines].join("\n");
}

/** 项目歧义/未命中时的候选清单 */
export function buildProjectCandidatesReply(
  query: string,
  matches: LarkProjectSummary[],
  now = Date.now(),
): string {
  const label = `匹配「${truncateText(query, 40)}」的项目`;
  if (!matches.length) {
    return `未找到${label}。`;
  }
  const lines = matches.map(
    (project, index) =>
      `${index + 1}. ${project.name} · ${project.path} · ${formatRelativeTime(project.lastActiveAt, now)}`,
  );
  return [`🔍 ${label}有多个，请用更精确的名称：`, ...lines].join("\n");
}

/** 「分支」指令回复：标记当前分支 */
export function buildBranchesReply(
  project: LarkProjectSummary,
  result: { current: string; branches: string[] },
): string {
  if (!result.branches.length) {
    return `🌿 ${project.name}：没有本地分支。`;
  }
  const lines = result.branches.map((branch) =>
    branch === result.current ? `• ${branch} ← 当前` : `• ${branch}`,
  );
  return [`🌿 ${project.name} 的本地分支`, ...lines].join("\n");
}

/** 带参数指令的用法提示 */
export function buildProjectCommandUsage(kind: ParsedProjectCommand["kind"]): string {
  switch (kind) {
    case "chat":
      return "用法：对话 <项目名> <消息>（如：对话 zen 修复登录 bug）";
    case "branches":
      return "用法：分支 <项目名>";
    case "checkout":
      return "用法：切换 <项目名> <分支名>";
    case "commit":
      return "用法：提交 <项目名> <说明>";
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
}

/** 「问询推送」的 markdown 文案（多条待答时尾注换成 #序号 指引） */
export function buildAskPushText(entry: LarkPendingAsk, pendingCount: number): string {
  const question = entry.question;
  const lines = [`🔔 Zen 问询 · ${entry.sessionTitle || "Zen 会话"}`];
  if (question.agentName) {
    lines.push(`来自 ${question.agentName}`);
  }
  lines.push(question.question);
  if (question.options.length) {
    lines.push("");
    question.options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option}`);
    });
    if (question.multiSelect) {
      lines.push("（可多选：回复「1,2」这样的编号组合）");
    }
  }
  lines.push("");
  lines.push(
    pendingCount > 1
      ? `多个问询待回答：回复 #序号 开头，如 #${entry.seq} <答案>`
      : "直接回复文字或选项编号即可",
  );
  return lines.join("\n");
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
): AskReplyResult {
  if (!pending.length) {
    return { reply: "当前没有待回答的问询。", resolvedAskIds: [], invalidAskIds: [] };
  }

  let entry: LarkPendingAsk | undefined;
  let answer = text.trim();

  if (pending.length > 1) {
    const match = /^#(\d+)[\s:：]*([\s\S]*)$/.exec(answer);
    if (!match) {
      return {
        reply: [
          `当前有 ${pending.length} 个问询待回答，请以 #序号 开头回复，如：#2 <答案>`,
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
          `#${seq} 不是当前待答问询。当前待答：`,
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
    return { reply: "当前没有待回答的问询。", resolvedAskIds: [], invalidAskIds: [] };
  }

  const mapped = mapOptionAnswer(answer, entry.question.options);
  const finalAnswer = mapped ?? answer;
  if (resolveAsk(entry.askId, finalAnswer)) {
    return {
      reply: `✅ 已回答：${truncateText(entry.question.question, 80)}`,
      resolvedAskIds: [entry.askId],
      invalidAskIds: [],
    };
  }
  return {
    reply: `该问询已失效（可能已在 Zen 内回答或已取消）：${truncateText(entry.question.question, 80)}`,
    resolvedAskIds: [],
    invalidAskIds: [entry.askId],
  };
}

// ---------- 进程管理薄封装（测试通过 deps 注入替身，不打真实网络） ----------

/** 飞书「对话」启动结果（与 agent-runner 的 startLarkChat 返回结构一致） */
export interface LarkChatStartResult {
  ok: boolean;
  sessionId?: string;
  title?: string;
  error?: string;
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
  /** 「对话」指令：按项目路径找到/新建工作区，新建会话并异步运行 agent */
  startChat?: (workspacePath: string, message: string) => Promise<LarkChatStartResult>;
  /** 「分支」指令：默认走 git-ops（30s 超时 + 输出截断） */
  listBranches?: (projectPath: string) => Promise<BranchListResult>;
  /** 「切换」指令：默认走 git-ops（脏工作区拒绝） */
  checkoutBranch?: (projectPath: string, branch: string) => Promise<CheckoutResult>;
  /** 「提交」指令：默认走 git-ops（add -A + commit） */
  commitProject?: (projectPath: string, message: string) => Promise<CommitResult>;
  /** 飞书会话 done 后读取最终助手回复（做完成推送摘要） */
  finalAssistantReply?: (sessionId: string) => string | null;
  /** 替身注入点：默认 spawn lark-cli event consume */
  spawnEvents?: (cliPath: string) => import("node:child_process").ChildProcess;
  /** 替身注入点：默认 execFile im +messages-send */
  sendMessage?: (
    cliPath: string,
    openId: string,
    markdown: string,
    idempotencyKey: string,
  ) => Promise<void>;
}

const READY_MARKER = "[event] ready event_key=";
const RESTART_DELAY_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_SEND_LENGTH = 4000;

function clampSendText(text: string): string {
  if (text.length <= MAX_SEND_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_SEND_LENGTH - 6)}\n…（已截断）`;
}

function defaultSpawnEvents(cliPath: string): import("node:child_process").ChildProcess {
  // stdin 保持打开不写入不 end：lark-cli event consume 靠 stdin 存活维持长连接
  return spawn(cliPath, ["event", "consume", "im.message.receive_v1", "--as", "bot"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function defaultSendMarkdown(
  cliPath: string,
  openId: string,
  markdown: string,
  idempotencyKey: string,
): Promise<void> {
  // execFile 不经 shell：markdown 里的特殊字符不会被 shell 解释
  await execFileAsync(
    cliPath,
    [
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--user-id",
      openId,
      "--markdown",
      markdown,
      "--idempotency-key",
      idempotencyKey,
    ],
    { timeout: 15_000 },
  );
}

export class LarkGateway {
  private state: LarkGatewayState = "off";
  private gatewayError: string | null = null;
  private child: import("node:child_process").ChildProcess | null = null;
  private cliPath: string | null = null;
  private allowedOpenId: string | null = null;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private stdoutBuffer = "";
  private stderrTail: string[] = [];
  /** askId → 待答问询 */
  private readonly pendingAsks = new Map<string, LarkPendingAsk>();
  /** 本网关刚写回的 askId（ask_resolved 事件到达时不重复提示） */
  private readonly selfResolved = new Set<string>();
  private askSeq = 0;
  private lastSendError: string | null = null;
  private readonly deduper = new LarkMessageDeduper();
  /** 飞书「对话」启动的会话（sessionId → 标题）：done 时推送最终回复摘要 */
  private readonly larkSessions = new Map<string, string>();

  constructor(private readonly deps: LarkGatewayDeps) {}

  snapshot(): { state: LarkGatewayState; gatewayError: string | null } {
    return { state: this.state, gatewayError: this.gatewayError };
  }

  /**
   * 启动事件网关（enabled 时由 ipc 层调用；重复调用幂等）。
   * allowedOpenId 变更无需重启子进程：事件过滤实时读最新值。
   */
  async start(settings: { allowedOpenId: string | null }): Promise<void> {
    this.allowedOpenId = settings.allowedOpenId;
    if (this.state === "starting" || this.state === "ready") {
      return;
    }
    this.stopping = false;
    this.consecutiveFailures = 0;
    this.cliPath = resolveLarkCliPath();
    if (!this.cliPath) {
      this.setState("error", "未找到 lark-cli 可执行文件，请先安装并登录 @larksuite/cli");
      return;
    }
    const auth = await readLarkAuthSnapshot();
    if (!auth.available) {
      this.setState("error", `lark-cli 不可用：${auth.error ?? "未知原因"}`);
      return;
    }
    if (!auth.botReady) {
      this.setState("error", "lark-cli bot 身份未就绪，请先运行 lark-cli auth login");
      return;
    }
    this.spawnConsumer();
  }

  /** 停止：SIGTERM 优雅退出（不 kill -9），清重启定时器 */
  stop(): void {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.consecutiveFailures = 0;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    this.setState("off", null);
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
    void this.sendReply(buildAskPushText(entry, this.pendingAsks.size));
  }

  /** ask_resolved 事件（含非飞书渠道回答）：移除待答；非本网关写回的补一条提示 */
  onAskResolved(askId: string): void {
    if (!this.pendingAsks.has(askId)) {
      return;
    }
    this.pendingAsks.delete(askId);
    if (this.selfResolved.delete(askId)) {
      return;
    }
    void this.sendReply("ℹ️ 该问询已在 Zen 内回答");
  }

  /** 「对话」启动成功后登记会话：done 时推送最终助手回复摘要 */
  trackSession(sessionId: string, title: string): void {
    this.larkSessions.set(sessionId, title);
  }

  /** 会话 done：清理该会话全部待答（问询随 run 终结，不再可回答） */
  onSessionDone(sessionId: string): void {
    for (const [askId, entry] of this.pendingAsks) {
      if (entry.sessionId === sessionId) {
        this.pendingAsks.delete(askId);
        this.selfResolved.delete(askId);
      }
    }
    const title = this.larkSessions.get(sessionId);
    if (!title) {
      return;
    }
    this.larkSessions.delete(sessionId);
    // emitTo 先喂网关再同步落库（persistRun），微任务里最终助手消息已持久化
    queueMicrotask(() => {
      const reply = this.deps.finalAssistantReply?.(sessionId)?.trim() || "（无文本回复）";
      void this.sendReply(`✅ ${title} 已完成\n${truncateText(reply, 800)}`);
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

  private spawnConsumer(): void {
    if (!this.cliPath) {
      return;
    }
    this.setState("starting", null);
    this.stdoutBuffer = "";
    this.stderrTail = [];
    let settled = false;
    let child: import("node:child_process").ChildProcess;
    try {
      child = (this.deps.spawnEvents ?? defaultSpawnEvents)(this.cliPath);
    } catch (error) {
      this.handleUnexpectedExit(error instanceof Error ? error.message : String(error));
      return;
    }
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.onStdoutChunk(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      this.onStderrChunk(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      this.child = null;
      this.handleUnexpectedExit(error.message);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      this.child = null;
      if (this.stopping) {
        // 主动 stop 已把状态置 off，不再重复广播
        return;
      }
      this.handleUnexpectedExit(
        signal ? `进程被信号终止（${signal}）` : `进程异常退出（code=${code ?? "null"}）`,
      );
    });
  }

  private onStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf("\n");
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index);
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      this.handleEventLine(line);
      index = this.stdoutBuffer.indexOf("\n");
    }
    // 异常超长半行（非 NDJSON 输出）直接丢弃，防内存膨胀
    if (this.stdoutBuffer.length > 1_000_000) {
      this.stdoutBuffer = "";
    }
  }

  private handleEventLine(line: string): void {
    const record = parseLarkEventLine(line);
    if (!record || !isHandleableLarkEvent(record, this.allowedOpenId)) {
      return;
    }
    if (!this.deduper.firstSeen(record.messageId)) {
      return;
    }
    void this.handleText(record.content).catch((error) => {
      console.warn("[lark] 处理飞书消息失败:", error);
    });
  }

  private onStderrChunk(chunk: string): void {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.includes(READY_MARKER)) {
        if (this.state !== "ready") {
          this.consecutiveFailures = 0;
          this.setState("ready", null);
        }
        continue;
      }
      this.stderrTail.push(trimmed);
      if (this.stderrTail.length > 20) {
        this.stderrTail.shift();
      }
    }
  }

  /** 非主动 stop 的退出：5s 退避重启；连续失败达到上限转 error 态停止重启 */
  private handleUnexpectedExit(reason: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const tail = this.stderrTail.slice(-5).join(" | ");
      this.setState(
        "error",
        `飞书事件监听连续 ${this.consecutiveFailures} 次异常退出（${reason}）${tail ? `：${tail}` : ""}`,
      );
      return;
    }
    this.setState("starting", `事件监听退出（${reason}），${RESTART_DELAY_MS / 1000}s 后重试`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping) {
        return;
      }
      this.spawnConsumer();
    }, RESTART_DELAY_MS);
  }

  private async handleText(text: string): Promise<void> {
    const command = parseLarkCommand(text);
    if (command === "sessions") {
      await this.sendReply(buildSessionsReply(this.deps.listSessions(10)));
      return;
    }
    if (command === "status") {
      await this.sendReply(
        buildStatusReply(this.deps.listSessions(50), (sessionId) =>
          this.firstPendingQuestion(sessionId),
        ),
      );
      return;
    }
    if (command === "help") {
      await this.sendReply(buildHelpReply());
      return;
    }
    if (command === "projects") {
      await this.sendReply(buildProjectsReply(this.deps.listProjects?.() ?? []));
      return;
    }
    const projectCommand = parseProjectCommand(text);
    if (projectCommand) {
      const reply = await this.handleProjectCommand(projectCommand);
      // null = 「对话」已自行发送回执（「已开始」/失败提示），无需补发
      if (reply !== null) {
        await this.sendReply(reply);
      }
      return;
    }
    const result = applyAskReply(text, [...this.pendingAsks.values()], this.deps.resolveAsk);
    for (const askId of result.resolvedAskIds) {
      this.pendingAsks.delete(askId);
      this.selfResolved.add(askId);
    }
    for (const askId of result.invalidAskIds) {
      this.pendingAsks.delete(askId);
    }
    await this.sendReply(result.reply);
  }

  /** 带参数指令执行；返回要回复的文案，null 表示已自行发送回复 */
  private async handleProjectCommand(cmd: ParsedProjectCommand): Promise<string | null> {
    if (cmd.kind === "chat" && (!cmd.project || !cmd.arg)) {
      return buildProjectCommandUsage("chat");
    }
    if (cmd.kind === "branches" && !cmd.project) {
      return buildProjectCommandUsage("branches");
    }
    if (cmd.kind === "checkout" && (!cmd.project || !cmd.arg)) {
      return buildProjectCommandUsage("checkout");
    }
    if (cmd.kind === "commit" && !cmd.project) {
      return buildProjectCommandUsage("commit");
    }

    const projects = this.deps.listProjects?.() ?? [];
    const matches = matchProjectSummaries(cmd.project, projects);
    if (!matches.length) {
      return `未找到匹配「${truncateText(cmd.project, 40)}」的项目。\n\n${buildProjectsReply(projects)}`;
    }
    if (matches.length > 1) {
      return buildProjectCandidatesReply(cmd.project, matches);
    }
    const project = matches[0]!;
    if (!project.path) {
      return `项目「${project.name}」没有本地路径。`;
    }

    if (cmd.kind === "chat") {
      if (!this.deps.startChat) {
        return "网关未装配会话启动能力。";
      }
      // 立即回执，不等 run 结束；运行状态走「状态」查询，完成后由网关推送摘要
      await this.sendReply(
        `🚀 已在「${project.name}」开始新会话：${truncateText(cmd.arg, 80)}\n运行期间可发送「状态」查看进度。`,
      );
      const result = await this.deps.startChat(project.path, cmd.arg);
      if (!result.ok) {
        await this.sendReply(`❌ 会话启动失败：${result.error ?? "未知原因"}`);
      }
      return null;
    }

    if (cmd.kind === "branches") {
      try {
        const branches = await (this.deps.listBranches ?? defaultListBranches)(project.path);
        return buildBranchesReply(project, branches);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `🌿 获取分支失败：${truncateText(message, 300)}`;
      }
    }

    if (cmd.kind === "checkout") {
      const result = await (this.deps.checkoutBranch ?? defaultCheckoutBranch)(
        project.path,
        cmd.arg,
      );
      if (result.ok) {
        return `✅ 已切换到分支 ${cmd.arg}（${project.name}）`;
      }
      if (result.dirty) {
        return [
          `⚠️ ${project.name} 有未提交变更，已拒绝切换分支。`,
          `请先发送「提交 ${cmd.project} <说明>」保存代码，再切换分支。`,
          "",
          truncateText(result.error ?? "", 500),
        ].join("\n");
      }
      return `❌ 切换失败：${result.error ?? "未知原因"}`;
    }

    // commit：缺省说明时用默认文案（提交信息尾部仍注明 via Zen/飞书）
    const result = await (this.deps.commitProject ?? defaultCommitAll)(
      project.path,
      cmd.arg || "Zen 飞书提交",
    );
    if (result.ok) {
      return `✅ 已提交（${project.name}）\n${result.summary ?? ""}`;
    }
    if (result.clean) {
      return `📭 ${project.name} 没有可提交的变更。`;
    }
    return `❌ 提交失败：${result.error ?? "未知原因"}`;
  }

  /** 指令回复发送；上一次发送失败时在本条前提示一次 */
  private async sendReply(text: string): Promise<void> {
    const notice = this.lastSendError;
    this.lastSendError = null;
    const body = notice ? `⚠️ 上一条消息发送失败：${notice}\n\n${text}` : text;
    await this.sendMarkdown(body);
  }

  async sendMarkdown(text: string): Promise<void> {
    const cliPath = this.cliPath;
    const openId = this.allowedOpenId;
    if (!cliPath || !openId) {
      // 未锁定允许的飞书用户时无处可发：记录原因，不抛错
      this.lastSendError = this.lastSendError ?? "未配置允许操控 zen 的飞书用户";
      return;
    }
    try {
      await (this.deps.sendMessage ?? defaultSendMarkdown)(
        cliPath,
        openId,
        clampSendText(text),
        randomUUID(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[lark] 飞书消息发送失败:", message);
      this.lastSendError = message;
    }
  }
}
