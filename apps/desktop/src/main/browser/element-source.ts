import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

/** 跳过的目录：依赖/产物/缓存，命中也不会是源码定位目标 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".output",
  "coverage",
  ".next",
  ".nuxt",
]);

/** 参与检索的源码文件扩展名 */
const SOURCE_EXTS = new Set([
  ".vue",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".jsx",
  ".tsx",
  ".svelte",
  ".html",
  ".css",
  ".scss",
]);

/** 遍历文件数上限（防超大工作区） */
const MAX_FILES = 4000;
/** 单文件读取上限：1.5MB */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

/** 排序：命中数多者优先，并列时路径短者优先（再并列按字典序保证稳定） */
function compareHits(a: { path: string; hits: number }, b: { path: string; hits: number }): number {
  if (a.hits !== b.hits) return b.hits - a.hits;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.path.localeCompare(b.path);
}

/**
 * 按元素源码线索检索工作区源码文件：返回相对 root 的路径（最多 3 个）。
 * 匹配为不区分大小写的子串包含；命中 ≥2 的前 3 个优先，
 * 若全部只有单命中但最强线索（hints[0]：id/testid）有命中，则返回前 2 个单命中文件。
 */
export async function resolveElementSourceFiles(
  hints: string[],
  root: string,
): Promise<string[]> {
  if (!hints?.length || !root) {
    return [];
  }
  const normalized = [...new Set(hints.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) {
    return [];
  }

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // 不可读目录（权限/符号链接断裂）：跳过
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        return;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await walk(full);
      } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  await walk(root);

  const scored: Array<{ path: string; hits: number; firstHintHit: boolean }> = [];
  const firstHint = normalized[0] ?? "";
  for (const file of files) {
    let content: string;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        continue;
      }
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lower = content.toLowerCase();
    let hits = 0;
    for (const hint of normalized) {
      if (lower.includes(hint)) {
        hits += 1;
      }
    }
    if (hits > 0) {
      scored.push({
        path: relative(root, file),
        hits,
        firstHintHit: firstHint !== "" && lower.includes(firstHint),
      });
    }
  }
  if (!scored.length) {
    return [];
  }
  scored.sort(compareHits);

  const multi = scored.filter((item) => item.hits >= 2).slice(0, 3);
  if (multi.length) {
    return multi.map((item) => item.path);
  }
  // 无 ≥2 命中：最强线索（hints[0]）命中的单命中文件兜底，最多 2 个
  const single = scored.filter((item) => item.firstHintHit).slice(0, 2);
  return single.map((item) => item.path);
}
