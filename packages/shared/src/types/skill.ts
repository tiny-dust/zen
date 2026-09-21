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
