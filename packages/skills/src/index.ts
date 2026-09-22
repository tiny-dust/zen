import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import matter from "gray-matter";

import type { SkillSummary } from "@zen/shared";

/**
 * 技能加载器（ADR-004）：扫描系统技能目录 + 用户自定义路径，
 * 解析 SKILL.md frontmatter（name/description）。
 * 兼容目录：~/.zen/skills（自有）、~/.claude/skills（Claude Code）、~/.agents/skills（通用）。
 */

export interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  dir: string;
  /** SKILL.md 正文（frontmatter 之外），按需读取 */
  body: string;
}

export function builtinSkillDirs(): string[] {
  return [
    join(homedir(), ".zen", "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".agents", "skills"),
  ];
}

function normalizeDir(dir: string): string {
  return dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
}

/** 单目录扫描：每个子目录（或目录本身）含 SKILL.md 即为一个技能 */
export async function scanSkillDir(dir: string): Promise<LoadedSkill[]> {
  const root = normalizeDir(dir);
  let rootInfo;
  try {
    rootInfo = await stat(root);
  } catch {
    return [];
  }
  if (!rootInfo.isDirectory()) {
    return [];
  }

  // 根目录本身就是技能（SKILL.md 直接在 root 下）
  const results: LoadedSkill[] = [];
  const direct = await tryLoadSkill(root);
  if (direct) {
    results.push(direct);
    return results;
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const skill = await tryLoadSkill(join(root, entry.name));
    if (skill) {
      results.push(skill);
    }
  }
  return results;
}

async function tryLoadSkill(dir: string): Promise<LoadedSkill | null> {
  const file = join(dir, "SKILL.md");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = matter(raw);
    const name = typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : dir.split(/[\\/]/).pop() ?? dir;
    const description =
      typeof parsed.data.description === "string" ? parsed.data.description.trim() : "";
    return {
      // id 用稳定路径派生，同一技能跨会话稳定
      id: dir,
      name,
      description,
      dir,
      body: parsed.content.trim(),
    };
  } catch {
    return null;
  }
}

/** 汇总扫描：系统目录 + 额外路径，按名称去重后返回（禁用列表由调用方叠加） */
export async function listSkills(extraPaths: string[]): Promise<SkillSummary[]> {
  const dirs = [...builtinSkillDirs(), ...extraPaths.filter((item) => item.trim())];
  const removableRoots = builtinSkillDirs();
  // 同名技能会互相抢触发词，按目录优先级只保留一个（~/.zen > ~/.claude > ~/.agents > 自定义）
  const byName = new Map<string, LoadedSkill>();
  for (const dir of dirs) {
    for (const skill of await scanSkillDir(dir)) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  }
  return [...byName.values()].map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    dir: skill.dir,
    source: skill.dir.startsWith(join(homedir(), ".zen")) ? "user" : "builtin",
    removable: removableRoots.some((root) => skill.dir.startsWith(root)),
    disabled: false,
  }));
}

/** 读取技能全文（按 id 即目录路径校验后读 SKILL.md） */
export async function readSkillById(
  id: string,
  extraPaths: string[],
): Promise<{ name: string; body: string } | null> {
  if (!isAbsolute(id)) {
    return null;
  }
  const dirs = [...builtinSkillDirs(), ...extraPaths.map(normalizeDir)];
  const allowed = dirs.some((dir) => id.startsWith(normalizeDir(dir)));
  if (!allowed) {
    return null;
  }
  const skill = await tryLoadSkill(id);
  return skill ? { name: skill.name, body: skill.body } : null;
}
