import { readdir, realpath, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import type { GitRepository } from "@zen/shared";

import { git } from "./git-exec";

/** 不扫描依赖、构建产物和 Git 内部目录，避免大型项目拖慢面板。 */
const SKIP_DIRS = new Set([
  ".git",
  ".cache",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release",
  "target",
]);
const MAX_DIRECTORIES = 20_000;
const MAX_REPOSITORIES = 200;

function describeRepository(scanRoot: string, repoPath: string): GitRepository {
  return {
    path: repoPath,
    relativePath: relative(scanRoot, repoPath) || ".",
    name: basename(repoPath),
  };
}

/** 仅识别目录自身的 Git 根；普通子目录即使属于父仓库也不会被重复列出。 */
async function repositoryRootAt(directory: string): Promise<string | null> {
  try {
    const topLevel = (await git(directory, ["rev-parse", "--show-toplevel"])).trim();
    const realTopLevel = await realpath(topLevel);
    return realTopLevel === directory ? realTopLevel : null;
  } catch {
    // 损坏或尚未初始化的 .git 标记不是可操作仓库。
    return null;
  }
}

/**
 * 发现工作区下的独立仓库与 Git worktree（.git 可以是文件）。
 * 扫描不跟随符号链接，避免越过所选目录或遇到循环；目录数和结果数设上限。
 */
export async function discoverGitRepositories(root: string): Promise<GitRepository[]> {
  const scanRoot = await realpath(resolve(root));
  if (!(await stat(scanRoot)).isDirectory()) {
    throw new Error("Git 扫描路径不是目录");
  }

  const repositories = new Map<string, GitRepository>();
  // 工作区可指向仓库的子目录；保留原有“显示所属父仓库”的行为。
  try {
    const topLevel = (await git(scanRoot, ["rev-parse", "--show-toplevel"])).trim();
    const repoPath = await realpath(topLevel);
    repositories.set(repoPath, describeRepository(scanRoot, repoPath));
  } catch {
    // 根目录不在任何仓库时继续查找内部独立仓库。
  }

  const pending = [scanRoot];
  let visited = 0;
  for (let index = 0; index < pending.length; index += 1) {
    if (visited >= MAX_DIRECTORIES || repositories.size >= MAX_REPOSITORIES) break;
    const directory = pending[index]!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === scanRoot) throw error;
      // 子目录不可读时，其它仓库仍可展示。
      continue;
    }

    const marker = entries.find(
      (entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()),
    );
    if (marker) {
      const repoPath = await repositoryRootAt(directory);
      if (repoPath) repositories.set(repoPath, describeRepository(scanRoot, repoPath));
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        pending.push(resolve(directory, entry.name));
      }
    }
  }

  return [...repositories.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}
