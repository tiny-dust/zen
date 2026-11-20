export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
}

export interface SkillDefinition extends SkillFrontmatter {
  id: string;
  rootDir: string;
  body: string;
  source: "builtin" | "user";
}

/** skills.sh 市场检索结果 */
export interface SkillMarketHit {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
}

/** 上游更新检测结果（git clone / skills.sh 市场安装） */
export interface SkillUpdateInfo {
  /** 对应 SkillSummary.id（技能目录路径） */
  id: string;
  name: string;
  dir: string;
  /** 是否有可更新内容 */
  hasUpdate: boolean;
  /** 检测通道：git 仓库比对 / skills.sh 详情 / 无上游 */
  via: "git" | "market" | "none";
  /** git 落后上游的提交数（仅 via=git） */
  behind?: number;
  /** 无更新或无法检测时的说明 */
  note?: string;
}

/** marketCheckUpdates 批量结果 */
export interface SkillUpdateCheckResult {
  ok: boolean;
  items: SkillUpdateInfo[];
  error?: string;
}

/**
 * 技能面板清单（技能目录下的 panel.json）：技能自带的看板/统计入口。
 * 对应 Claude Code 插件的 modules/UI 槽位——zen 不执行技能代码，只按声明渲染：
 * 有 ui 就走内联 iframe（sandbox 隔离），没有 ui 就用内置指标行。
 */
export interface SkillPanelManifest {
  /** 协议版本，当前只有 1 */
  version: 1;
  /** 面板标题（通常就是技能名） */
  title: string;
  /** 本会话用到该技能后自动显示；缺省 true */
  showOnSkillUse?: boolean;
  /** 面板 HTML 入口（技能目录内相对路径）；缺省走内置指标渲染 */
  ui?: string;
  /** 内置指标（无 ui 时渲染成一行指标条） */
  metrics?: SkillPanelMetric[];
  /** 命令名 → 内置动作；`/skill:<name> <命令>` 触发 */
  commands?: Record<string, "toggle">;
}

/** 内置指标：zen 能从会话里真实拿到的数据，缺数据的指标不显示 */
export type SkillPanelMetric =
  | "rounds"
  | "tools"
  | "elapsed"
  | "tests"
  | "tokens"
  | "cacheHit";

/** 技能面板读取结果：manifest 原样返回，ui 内容单独给（防越权由 @zen/skills 校验） */
export interface SkillPanelInfo {
  /** 技能目录（SkillSummary.id） */
  dir: string;
  manifest: SkillPanelManifest;
  /** ui 入口的 HTML 内容；无 ui 或读取失败时缺省 */
  html?: string;
}

/** 推给面板 iframe 的会话指标快照 */
export interface SkillPanelMetrics {
  rounds: number;
  tools: number;
  elapsedMs: number;
  tests: "none" | "pass" | "fail";
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHitRate: number | null;
}
