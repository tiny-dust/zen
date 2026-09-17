/**
 * Agent 运行配置：权限模式、隔离区、技能路径、提示词、云同步。
 * 持久化在 ~/.zen/config.json（用户可见、可手动编辑的应用域配置）。
 */

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
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  permissionMode: "smart",
  sandboxMode: "direct",
  sandboxRoot: null,
  skillExtraPaths: [],
  prompt: { presetId: "zen-default", customText: "" },
  syncEnabled: false,
  syncRepo: null,
};

/** Agent 向用户提问（askUser 工具触发，展示在输入框上方） */
export interface AskUserQuestionEvent {
  askId: string;
  toolCallId: string;
  question: string;
  /** 可选项；为空时只显示自由输入 */
  options: string[];
  /** 允许自由输入；默认 true */
  allowFreeText: boolean;
}

/** 用户对 askUser 提问的回答 */
export interface AskUserAnswer {
  askId: string;
  answer: string;
}

/** 设置页展示的技能条目（扫描结果，含启用状态） */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  /** 技能所在目录（供展示与排错） */
  dir: string;
  source: "builtin" | "user";
  /** 禁用的技能 id 列表在 AgentSettings 外单独存（disabledSkills） */
  disabled: boolean;
}

/** 设置页展示的 MCP 服务器状态 */
export interface McpServerStatus {
  config: import("./mcp").McpServerConfig;
  /** 进程状态 */
  state: "stopped" | "starting" | "running" | "error";
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
