import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import matter from "gray-matter";

import type { SkillFileContent, SkillFileInfo, SkillSummary } from "@zen/shared";

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

  // 根目录本身就是技能（SKILL.md 直接在 root 下）时一并收录；
  // 子目录仍继续扫描——兼容目录（~/.claude/skills 等）根下可能混有
  // 旧版 CLI 落在根的 SKILL.md，不能因它存在就跳过整个子目录扫描，
  // 否则之后市场安装的所有子目录技能全部不可见。
  const results: LoadedSkill[] = [];
  const direct = await tryLoadSkill(root);
  if (direct) {
    results.push(direct);
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
    // 仅内置根的严格子目录可卸载：根目录本身（混入根的 SKILL.md）不可，
    // 否则会 rm -rf 整个 ~/.claude/skills
    removable: removableRoots.some((root) => skill.dir.startsWith(root + sep)),
    disabled: false,
  }));
}

/** 读取技能全文：支持技能目录 id（绝对路径）或技能名（如 "coder"） */
export async function readSkillById(
  idOrName: string,
  extraPaths: string[],
): Promise<{ name: string; body: string } | null> {
  const key = idOrName.trim();
  if (!key) {
    return null;
  }
  if (isAbsolute(key)) {
    const dirs = [...builtinSkillDirs(), ...extraPaths.map(normalizeDir)];
    const allowed = dirs.some((dir) => key.startsWith(normalizeDir(dir)));
    if (!allowed) {
      return null;
    }
    const skill = await tryLoadSkill(key);
    return skill ? { name: skill.name, body: skill.body } : null;
  }
  // 按名称解析：与 listSkills 同名去重优先级一致（~/.zen > ~/.claude > ~/.agents > 自定义）
  const summary = (await listSkills(extraPaths)).find(
    (item) => item.name === key || item.dir.split(/[\\/]/).pop() === key,
  );
  if (!summary) {
    return null;
  }
  const skill = await tryLoadSkill(summary.dir);
  return skill ? { name: skill.name, body: skill.body } : null;
}

/** 技能目录文件枚举上限：技能目录一般 < 50 个文件，200 已是宽松护栏 */
const MAX_SKILL_FILES = 200;

/** 单文件读取上限（字节）：技能文件都是文本，512KB 足够覆盖最大规范文档 */
const MAX_SKILL_FILE_BYTES = 512 * 1024;

/** 渲染层传来的 dir 不可信：必须是已知技能根的严格子目录 */
function isAllowedSkillDir(dir: string, extraPaths: string[]): boolean {
  const normalized = normalizeDir(dir);
  const roots = [...builtinSkillDirs(), ...extraPaths.map(normalizeDir)];
  return roots.some((root) => normalized.startsWith(root + sep));
}

/** 技能目录内文件枚举（技能调用 tag 弹窗用）：跳过点开头目录与 node_modules */
export async function listSkillFiles(
  dir: string,
  extraPaths: string[],
): Promise<SkillFileInfo[]> {
  const root = normalizeDir(dir);
  if (!root || !isAllowedSkillDir(root, extraPaths)) {
    return [];
  }
  const files: SkillFileInfo[] = [];
  const walk = async (current: string, rel: string): Promise<void> => {
    if (files.length >= MAX_SKILL_FILES) {
      return;
    }
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_SKILL_FILES) {
        return;
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const child = join(current, entry.name);
      let info;
      try {
        info = await stat(child);
      } catch {
        continue; // 断链 symlink 等直接跳过
      }
      if (info.isDirectory()) {
        await walk(child, childRel);
      } else if (info.isFile()) {
        files.push({ path: childRel, size: info.size });
      }
    }
  };
  await walk(root, "");
  // SKILL.md（实际注入对话的文件）固定排最前，其余按路径排序
  files.sort((a, b) => {
    if (a.path === "SKILL.md") {
      return -1;
    }
    if (b.path === "SKILL.md") {
      return 1;
    }
    return a.path.localeCompare(b.path);
  });
  return files;
}

/** 读取技能目录内单个文件：路径校验（禁绝对路径/越权/二进制）+ 大小截断 */
export async function readSkillFile(
  dir: string,
  relPath: string,
  extraPaths: string[],
): Promise<SkillFileContent> {
  const root = normalizeDir(dir);
  if (!root || !isAllowedSkillDir(root, extraPaths)) {
    return { ok: false, error: "skill directory not allowed" };
  }
  const rel = String(relPath ?? "").trim();
  if (
    !rel ||
    isAbsolute(rel) ||
    rel.split(/[\\/]/).some((seg) => seg === ".." || seg === "")
  ) {
    return { ok: false, error: "invalid file path" };
  }
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) {
    return { ok: false, error: "invalid file path" };
  }
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    return { ok: false, error: "file read failed" };
  }
  // 含 NUL 字节视为二进制（图片/字体等），不进文本渲染链路
  if (buf.includes(0)) {
    return { ok: false, error: "binary file not supported" };
  }
  const truncated = buf.length > MAX_SKILL_FILE_BYTES;
  const content = (truncated ? buf.subarray(0, MAX_SKILL_FILE_BYTES) : buf).toString("utf8");
  return { ok: true, content, truncated };
}
