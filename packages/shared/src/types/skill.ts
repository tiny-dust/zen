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
