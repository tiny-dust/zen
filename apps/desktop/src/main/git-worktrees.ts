import { stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import type { RepoWorktree, WorktreeListResult, WorktreeRemoveResult } from "@zen/shared";

import { git } from "./git-exec";
import { describeGitError } from "./git-remote";
import { findSessionIdByWorktreePath, removeSessionWorktree } from "./session-worktree";

interface ParsedWorktree {
  path: string;
  head: string;
  branchRef: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
}

/**
 * `git worktree list --porcelain -z`：字段之间用 \0 分隔，块之间多一个 \0。
 * 路径可能含空格/换行，不能按行切。
 */
function parseWorktreeListPorcelain(output: string): ParsedWorktree[] {
  const blocks: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;
  for (const token of output.split("\0")) {
    if (!token) {
      if (current) {
        blocks.push(current);
        current = null;
      }
      continue;
    }
    const space = token.indexOf(" ");
    const key = space === -1 ? token : token.slice(0, space);
    const value = space === -1 ? "" : token.slice(space + 1);
    if (key === "worktree") {
      // 正常由空 token 分块；这里兜底，避免首个块前缺分隔时丢数据
      if (current) {
        blocks.push(current);
      }
      current = {
        path: value,
        head: "",
        branchRef: "",
        detached: false,
        bare: false,
        locked: false,
        lockReason: "",
        prunable: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branchRef = value;
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "bare") {
      current.bare = true;
    } else if (key === "locked") {
      current.locked = true;
      current.lockReason = value;
    } else if (key === "prunable") {
      current.prunable = true;
    }
  }
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

async function readWorktrees(repoPath: string): Promise<ParsedWorktree[]> {
  return parseWorktreeListPorcelain(await git(repoPath, ["worktree", "list", "--porcelain", "-z"]));
}

function branchLabel(entry: ParsedWorktree): string {
  if (entry.branchRef) {
    return entry.branchRef.replace(/^refs\/heads\//, "");
  }
  if (entry.bare) {
    return "bare";
  }
  return `detached@${entry.head.slice(0, 7) || "unknown"}`;
}

function blockedReasonOf(entry: ParsedWorktree, index: number, missing: boolean): string | undefined {
  if (index === 0) {
    return "主工作树不能删除";
  }
  if (entry.locked) {
    return entry.lockReason ? `该工作树已锁定（${entry.lockReason}）` : "该工作树已锁定";
  }
  if (missing) {
    return "目录已丢失，仅可清理 Git 登记";
  }
  return undefined;
}

/**
 * 仓库里 Git 登记的全部工作树（含 Agent / 其他工具创建的链接工作树）。
 * repoPath 可以是仓库根或仓库内任意目录；返回的 repoPath 统一为 Git 认定的主工作树路径。
 */
export async function listRepoWorktrees(
  repoPath: string,
  currentPath?: string,
): Promise<WorktreeListResult> {
  const target = repoPath?.trim();
  if (!target) {
    return { repos: [], error: "仓库路径不能为空" };
  }
  try {
    const entries = await readWorktrees(target);
    if (!entries.length) {
      return { repos: [], error: "该目录不是 Git 仓库" };
    }
    const root = resolve(entries[0]!.path);
    const current = currentPath?.trim() ? resolve(currentPath) : null;
    const worktrees: RepoWorktree[] = [];
    for (const [index, entry] of entries.entries()) {
      const entryPath = resolve(entry.path);
      // stat 失败或不是目录即视为目录已丢失（Git 登记仍在）
      const missing = !(await stat(entryPath).catch(() => null))?.isDirectory();
      const sessionId = findSessionIdByWorktreePath(entryPath);
      const blockedReason = blockedReasonOf(entry, index, missing);
      worktrees.push({
        path: entryPath,
        branch: branchLabel(entry),
        head: entry.head,
        kind: index === 0 ? "main" : "linked",
        detached: entry.detached,
        bare: entry.bare,
        locked: entry.locked,
        ...(entry.lockReason ? { lockReason: entry.lockReason } : {}),
        prunable: entry.prunable,
        missing,
        ...(sessionId ? { sessionId } : {}),
        current: !!current && entryPath === current,
        operable: !entry.bare && !missing,
        ...(blockedReason ? { blockedReason } : {}),
      });
    }
    return { repos: [{ repoPath: root, repoName: basename(root), worktrees }] };
  } catch (error) {
    return { repos: [], error: describeGitError(error, "读取工作树列表失败") };
  }
}

/**
 * 删除一个链接工作树：永不加 --force，不顺带删分支。
 * 只接受该仓库 Git 当前登记的路径，防止渲染层伪造路径删任意目录。
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<WorktreeRemoveResult> {
  const repo = repoPath?.trim();
  const target = worktreePath?.trim();
  if (!repo || !target) {
    return { ok: false, error: "仓库路径与工作树路径不能为空" };
  }
  if (!isAbsolute(repo) || !isAbsolute(target)) {
    return { ok: false, error: "仓库路径与工作树路径必须是绝对路径" };
  }

  let entries: ParsedWorktree[];
  try {
    entries = await readWorktrees(repo);
  } catch (error) {
    return { ok: false, error: describeGitError(error, "读取工作树列表失败") };
  }
  const targetPath = resolve(target);
  const index = entries.findIndex((entry) => resolve(entry.path) === targetPath);
  const entry = index >= 0 ? entries[index]! : null;
  if (!entry) {
    return { ok: false, error: "该目录不是这个仓库登记的工作树" };
  }
  if (index === 0 || entry.bare) {
    return { ok: false, error: "主工作树不能删除" };
  }
  if (entry.locked) {
    return {
      ok: false,
      error: entry.lockReason ? `该工作树已锁定（${entry.lockReason}）` : "该工作树已锁定",
    };
  }

  const repoRoot = resolve(entries[0]!.path);
  if (!(await stat(targetPath).catch(() => null))?.isDirectory()) {
    try {
      // 目录已丢失：只清理 Git 登记。prune 清理该仓库全部可清理项，分支与提交保留
      await git(repoRoot, ["worktree", "prune"]);
      const remaining = await readWorktrees(repoRoot).catch(() => []);
      if (remaining.some((item) => resolve(item.path) === targetPath)) {
        return { ok: false, error: "Git 未能清理该工作树登记，请检查仓库状态" };
      }
      return { ok: true, pruned: true };
    } catch (error) {
      return { ok: false, error: describeGitError(error, "清理工作树登记失败") };
    }
  }

  try {
    const changes = await git(targetPath, ["status", "--porcelain", "--untracked-files=all", "--ignored"]);
    if (changes.trim()) {
      return { ok: false, error: "工作树内仍有修改、未跟踪或忽略的文件，请先处理后再移除" };
    }
  } catch (error) {
    return { ok: false, error: describeGitError(error, "检查工作树状态失败") };
  }

  // Zen 管理的绑定走现有移除逻辑：保留它对路径与绑定的校验，并清理 session_worktrees 记录
  const sessionId = findSessionIdByWorktreePath(targetPath);
  if (sessionId) {
    try {
      await removeSessionWorktree(sessionId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describeGitError(error, "移除会话工作树失败") };
    }
  }

  try {
    await git(repoRoot, ["worktree", "remove", targetPath]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "移除工作树失败") };
  }
}
