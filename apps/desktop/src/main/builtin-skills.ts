import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { app } from "electron";

/**
 * zen 自带、随版本更新的技能：启动时同步到 ~/.zen/skills。
 * 只覆盖这几项（zen 拥有其内容），用户自己装的技能一概不碰。
 */
const BUILTIN_SKILLS = ["skill-router"] as const;

/** 模板目录：dev 在仓库 resources/templates/skills，打包后在 Resources/templates/skills */
function templateDirs(): string[] {
  return [
    join(process.resourcesPath, "templates", "skills"),
    join(app.getAppPath(), "..", "..", "resources", "templates", "skills"),
  ];
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** SKILL.md 内容一致即视为已同步（避免每次启动重复写盘） */
async function sameSkill(from: string, to: string): Promise<boolean> {
  try {
    const [source, target] = await Promise.all([
      readFile(join(from, "SKILL.md"), "utf8"),
      readFile(join(to, "SKILL.md"), "utf8"),
    ]);
    return source === target;
  } catch {
    return false;
  }
}

/** 把内置技能从模板目录同步到目标技能根；返回本次写入的技能名 */
export async function syncBuiltinSkills(
  sourceRoot: string,
  targetRoot: string,
): Promise<string[]> {
  if (!(await isDirectory(sourceRoot))) {
    return [];
  }
  const synced: string[] = [];
  for (const name of BUILTIN_SKILLS) {
    const from = join(sourceRoot, name);
    if (!(await isDirectory(from))) {
      continue;
    }
    const to = join(targetRoot, name);
    if (await sameSkill(from, to)) {
      continue;
    }
    try {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true, force: true });
      synced.push(name);
    } catch (error) {
      console.warn(`[skills] 内置技能 ${name} 同步失败:`, error);
    }
  }
  return synced;
}

/** 启动时调用：读不到模板目录（未打包资源/开发未构建）就静默跳过，不阻塞启动 */
export async function ensureBuiltinSkills(): Promise<void> {
  const targetRoot = join(homedir(), ".zen", "skills");
  for (const source of templateDirs()) {
    const synced = await syncBuiltinSkills(source, targetRoot);
    if (synced.length) {
      return;
    }
  }
}
