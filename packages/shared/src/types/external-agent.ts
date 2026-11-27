/**
 * 外部 agent 会话（只读）：Claude Code / Codex / Gemini CLI / DSH / Grok 在各自目录里留下的
 * 本地会话文件。这里只描述「读出来给界面看」的数据形状，不含任何写入或续聊能力。
 */

export const EXTERNAL_AGENT_CLIENTS = ["claude", "codex", "gemini", "dsh", "grok"] as const;

export type ExternalAgentClient = (typeof EXTERNAL_AGENT_CLIENTS)[number];

/**
 * 会话状态：只从会话文件无法可靠判断进程是否还在跑，
 * 所以默认 unverified；只有 DSH 的 session.lock 能给出可信的 running / idle。
 */
export type ExternalSessionStatus = "unverified" | "running" | "idle";

export interface ExternalSessionSummary {
  /** 稳定键：<client>:<sessionId>，同 client 内唯一 */
  id: string;
  client: ExternalAgentClient;
  sessionId: string;
  /** 会话标题：客户端自己记的标题优先，其次首条用户消息，最后目录名 */
  title: string;
  cwd?: string;
  /** 文件最后写入时间（ms） */
  updatedAt: number;
  status: ExternalSessionStatus;
  /** 轨迹条数（列表用，避免把全文塞进列表响应） */
  eventCount: number;
  /** 会话文件绝对路径（只在本机展示，便于对照） */
  path: string;
  /** 该会话能否在原厂商 CLI 里续聊（由能力矩阵 + 会话可得性推出） */
  resumable?: boolean;
  /** 不能续聊的原因键，界面按 key 取文案 */
  resumeBlocked?: ExternalResumeBlocked;
}

export type ExternalTraceKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "result"
  | "error"
  | "unknown";

export interface ExternalTraceEvent {
  kind: ExternalTraceKind;
  text: string;
  /** 工具名（kind=tool / result 时尽力给出） */
  toolName?: string;
  time?: number;
  /** 原始事件类型：未知事件保留可辨认摘要时用来提示来源 */
  sourceType?: string;
  isError?: boolean;
}

export interface ExternalSessionTrace {
  id: string;
  events: ExternalTraceEvent[];
  /** 轨迹被截断（超过事件上限或字节上限）时为 true，界面要明确提示 */
  truncated: boolean;
  /** 读取失败的原因；有值时不把空列表当成「这个会话没有内容」 */
  error?: string;
}

/** scan 结果：每个客户端的分组信息，用于界面按客户端筛选与「未安装」提示 */
export interface ExternalScanGroup {
  client: ExternalAgentClient;
  /** 本机是否找到该客户端的会话目录 */
  detected: boolean;
  count: number;
}

export interface ExternalSessionsResult {
  sessions: ExternalSessionSummary[];
  groups: ExternalScanGroup[];
  /** 扫描过程中被跳过的文件数（超大/损坏/权限不足），界面不展示细节但要能说明 */
  skipped: number;
}

// ---------------------------------------------------------------------------
// 续聊：在厂商自己的会话里继续对话（调用本机 CLI，沿用原会话 ID）
// ---------------------------------------------------------------------------

/**
 * 续聊能力：
 * - supported：已核实该 CLI 支持用会话 ID 续聊，参数配方在 cli-recipes 里固定
 * - missing-cli：本机 PATH 里没有该命令
 * - unsupported：CLI 存在但没有可用的续聊参数（不猜参数、不伪造「继续」）
 */
export type ExternalResumeSupport = "supported" | "missing-cli" | "unsupported";

export interface ExternalClientCapability {
  client: ExternalAgentClient;
  /** CLI 命令名（claude / codex / gemini / dsh / grok） */
  command: string;
  /** PATH 解析到的绝对路径；null = 未安装 */
  path: string | null;
  resume: ExternalResumeSupport;
  /** 界面直接展示的原因说明（未安装 / 版本不支持续聊 / 需求未验证） */
  note?: string;
}

/** 续聊被拦下的原因键，界面按 key 取文案 */
export type ExternalResumeBlocked = "missing-cli" | "unsupported" | "unknown-session";

/** 发起一条续聊消息；id 是 ExternalSessionSummary.id（`<client>:<sessionId>`） */
export interface ExternalRunRequest {
  id: string;
  message: string;
}

export interface ExternalRunStarted {
  runId: string;
}

/** 续聊流事件：started → delta* → done | error | stopped */
export interface ExternalRunEvent {
  /** 对应 ExternalSessionSummary.id */
  id: string;
  runId: string;
  type: "started" | "delta" | "done" | "error" | "stopped";
  text?: string;
  error?: string;
}
