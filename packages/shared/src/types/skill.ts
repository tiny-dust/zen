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
