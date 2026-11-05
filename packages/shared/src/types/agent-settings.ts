/**
 * Agent 运行配置：权限模式、隔离区、技能路径、提示词、云同步。
 * 持久化在 ~/.zen/config.json（用户可见、可手动编辑的应用域配置）。
 */

import type { LarkBridgeSettings } from "./lark";
import { DEFAULT_LARK_BRIDGE_SETTINGS } from "./lark";
import type { PromptViewVersion } from "./prompts";

/** 权限模式：默认（全部确认）/ 智能（按风险分级）/ 完全访问（全部放行） */
export type PermissionMode = "default" | "smart" | "full";

export const PERMISSION_MODES: Array<{ id: PermissionMode; label: string; description: string }> = [
  {
    id: "default",
    label: "默认权限",
    description: "读文件自动放行，写文件、终端、网络请求全部需要确认",
  },
  {
    id: "smart",
    label: "智能权限",
    description: "工作区内写文件自动放行，越界写入/危险命令/网络请求需要确认",
  },
  {
    id: "full",
    label: "完全访问权限",
    description: "所有工具调用自动放行，请仅在信任的项目中使用",
  },
];

/** 项目操作模式：直接在项目目录，或复制进隔离区后再操作 */
export type SandboxMode = "direct" | "isolated";

/** 提示词来源：内置预设 id 或自定义文本 */
export interface PromptSelection {
  /** "zen-default" | 内置预设 id | "custom" */
  presetId: string;
  /** presetId === "custom" 时的自定义系统提示词 */
  customText: string;
  /** 运行时注入的版本：提炼版（默认）/ 完整中文版 / 完整英文原文；仅对内置预设生效 */
  version?: PromptViewVersion;
}

/**
 * 命令前缀审批规则：命中 allow 前缀的执行类命令（runTerminal 等）自动放行，
 * 不再逐次弹审批卡；ask=该前缀保持人工确认。
 */
export interface CommandApprovalRule {
  /** 命令前缀（trim 后 startsWith 语义匹配，大小写不敏感） */
  pattern: string;
  decision: "allow" | "ask";
}

export interface AgentSettings {
  permissionMode: PermissionMode;
  sandboxMode: SandboxMode;
  /** 隔离区根目录，缺省 ~/.zen/sandbox */
  sandboxRoot: string | null;
  /** 技能额外目录（在系统目录之外，可多选/手动添加） */
  skillExtraPaths: string[];
  prompt: PromptSelection;
  /** 配置云同步（GitHub 私密仓库）开关 */
  syncEnabled: boolean;
  /** 云同步仓库名，缺省 zen-config */
  syncRepo: string | null;
  /** 飞书集成：bot 私信查询/问询回流 */
  larkBridge: LarkBridgeSettings;
  /** CUA 桌面自动化（agent 的 cua.* 工具）总开关：默认关闭 */
  cuaEnabled: boolean;
  /** 命令前缀审批规则表（向后兼容：旧配置缺省为空表） */
  approvalRules: CommandApprovalRule[];
  /** 帮我核准：审批请求先交助手模型自动审阅；off=关闭（默认） */
  approvalReviewer: "off" | "assistant";
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  permissionMode: "smart",
  sandboxMode: "direct",
  sandboxRoot: null,
  skillExtraPaths: [],
  prompt: { presetId: "zen-default", customText: "", version: "distilled" },
  syncEnabled: false,
  syncRepo: null,
  larkBridge: DEFAULT_LARK_BRIDGE_SETTINGS,
  cuaEnabled: false,
  approvalRules: [],
  approvalReviewer: "off",
};

/**
 * 选项推荐等级：模型给每条预设选项标注推荐度，卡片按它展示徽标并排序；
 * 问询本身不再带优先级。
 * strong = 强烈推荐，recommended = 推荐，neutral = 一般，avoid = 不推荐。
 */
export type AskUserOptionPriority = "strong" | "recommended" | "neutral" | "avoid";

export const ASK_USER_OPTION_PRIORITIES: readonly AskUserOptionPriority[] = [
  "strong",
  "recommended",
  "neutral",
  "avoid",
];

export function isAskUserOptionPriority(value: unknown): value is AskUserOptionPriority {
  return ASK_USER_OPTION_PRIORITIES.includes(value as AskUserOptionPriority);
}

/** 一个预设选项：label 即点选后回传给模型的答案文本 */
export interface AskUserOption {
  label: string;
  /** 推荐等级；缺省表示模型未标注 */
  priority?: AskUserOptionPriority;
}

/** 选项文案：兼容历史事件里的裸字符串写法 */
export function askOptionLabel(option: AskUserOption | string): string {
  return typeof option === "string" ? option : option.label;
}

/** 选项推荐等级：裸字符串或未标注返回 undefined */
export function askOptionPriority(
  option: AskUserOption | string,
): AskUserOptionPriority | undefined {
  return typeof option === "string" ? undefined : option.priority;
}

const ASK_OPTION_RANK: Record<AskUserOptionPriority, number> = {
  strong: 0,
  recommended: 1,
  neutral: 2,
  avoid: 3,
};

/** 按推荐度排序：强烈推荐在前、不推荐在后，未标注排末尾；同级保持原顺序 */
export function sortAskOptions<T extends AskUserOption | string>(options: readonly T[]): T[] {
  const rank = (option: T) => {
    const priority = askOptionPriority(option);
    return priority ? ASK_OPTION_RANK[priority] : ASK_USER_OPTION_PRIORITIES.length;
  };
  return [...options].sort((a, b) => rank(a) - rank(b));
}

/** Agent 向用户提问（askUser 工具触发，展示在输入框上方；多问询可并存） */
export interface AskUserQuestionEvent {
  askId: string;
  toolCallId: string;
  question: string;
  /** 可选项（含推荐等级）；为空时只显示自由输入。允许裸字符串以兼容历史事件 */
  options: Array<AskUserOption | string>;
  /** 选项是否可多选（多选时 UI 显示勾选态 + 统一提交按钮）；缺省单选 */
  multiSelect?: boolean;
  /** 允许自由输入；默认 true */
  allowFreeText: boolean;
  /** 来源子 Agent 展示名（主 Agent 提问时无） */
  agentName?: string;
  /** 发起提问的会话 id（子 Agent 为 parent::agentId，便于排错） */
  sourceSessionId?: string;
}

/** 用户对 askUser 提问的回答 */
export interface AskUserAnswer {
  askId: string;
  answer: string;
}

/** 技能目录内单个文件（技能调用 tag 弹窗用） */
export interface SkillFileInfo {
  /** 相对技能目录的 posix 风格路径（如 "references/baseline.md"） */
  path: string;
  /** 文件字节数 */
  size: number;
}

/** 技能文件读取结果（含越权/二进制/截断等错误形态） */
export interface SkillFileContent {
  ok: boolean;
  content?: string;
  /** 超过读取上限被截断 */
  truncated?: boolean;
  error?: string;
}

/** 设置页展示的技能条目（扫描结果，含启用状态） */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  /** 技能所在目录（供展示与排错） */
  dir: string;
  source: "builtin" | "user";
  /** 是否可从 Zen 卸载（位于用户技能目录：~/.zen、~/.claude、~/.agents） */
  removable: boolean;
  /** 禁用的技能 id 列表在 AgentSettings 外单独存（disabledSkills） */
  disabled: boolean;
}

/** 设置页展示的 MCP 服务器状态 */
export interface McpServerStatus {
  config: import("./mcp").McpServerConfig;
  /** 进程状态；needs-auth 表示远程服务要求 OAuth，需用户浏览器授权 */
  state: "stopped" | "starting" | "running" | "error" | "needs-auth";
  error?: string;
  tools: import("./mcp").McpToolInfo[];
}

/** 云同步结果（不含任何密钥明文） */
export interface SyncResult {
  ok: boolean;
  /** 仓库 full-name，如 reynold/zen-config */
  repo?: string;
  error?: string;
  /** 导入/导出的概要 */
  summary?: string;
}
