import type { SkillSummary } from "@zen/shared";

/**
 * 技能来源徽标：按所在目录归类（~/.zen=Zen 自有，~/.claude=Claude，~/.agents=Agents，
 * 其余为用户自定义扫描目录）。用「目录」而不是可卸载性表达归类——
 * 用户装在 ~/.claude 的技能以前被标成「系统」，与可卸载行为自相矛盾。
 */
export function skillSourceLabel(skill: Pick<SkillSummary, "dir">): string {
  const dir = skill.dir.replace(/\\/g, "/");
  if (dir.includes("/.zen/skills")) {
    return "Zen";
  }
  if (dir.includes("/.claude/skills")) {
    return "Claude";
  }
  if (dir.includes("/.agents/skills")) {
    return "Agents";
  }
  return "自定义";
}
