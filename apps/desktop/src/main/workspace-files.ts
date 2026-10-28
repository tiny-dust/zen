import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { WorkspaceFile } from "@zen/shared";

/** 目录级忽略：体量大、无浏览价值，且会把条目预算吃光 */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".coder",
  ".playwright-mcp",
]);

/**
 * 单次列举的条目上限：文件树与 @ 引用共用，防超大工作区把 IPC 与界面拖垮。
 * 取值覆盖常见的多项目仓库（前端 + 后端在一个工作区里约 8k 条目 ≈ 1.2MB / 70ms）；
 * 即便触顶，逐层展开也能保证浅层目录（含整个项目文件夹）先被列出。
 */
export const MAX_FILES = 20000;

/** 目录递归深度上限 */
export const MAX_DEPTH = 10;

/**
 * 列出工作区全部文件（文件树 / @ 引用筛选用）。
 *
 * 逐层展开（广度优先）：同一层的目录先全部列完，再一起下沉。
 * 深度优先 + 条数上限时，第一个大目录（例如仓库里的后端项目）会先把预算吃满，
 * 排在它后面的同级目录连目录项都不会出现——表现为「工作区里少了整个项目」。
 */
export async function listWorkspaceFiles(
  root: string,
  options: { maxFiles?: number; maxDepth?: number } = {},
): Promise<WorkspaceFile[]> {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const results: WorkspaceFile[] = [];

  // 当前层待展开的目录（绝对路径）+ 下一层收集
  let level: string[] = [root];
  let depth = 0;
  while (level.length > 0 && depth <= maxDepth && results.length < maxFiles) {
    const nextLevel: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (results.length >= maxFiles) {
          break;
        }
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        const abs = join(dir, entry.name);
        results.push({ path: relative(root, abs), name: entry.name, isDir: entry.isDirectory() });
        if (entry.isDirectory()) {
          nextLevel.push(abs);
        }
      }
    }
    level = nextLevel;
    depth += 1;
  }

  return results;
}
