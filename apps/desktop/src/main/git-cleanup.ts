import type { GitBranchCleanupResult, GitBranchCleanupSkipped } from "@zen/shared";

import { git } from "./git-exec";
import { describeGitError } from "./git-remote";

interface LocalBranch {
  name: string;
  current: boolean;
  upstreamGone: boolean;
}

async function listBranches(workdir: string): Promise<LocalBranch[]> {
  const output = await git(workdir, [
    "for-each-ref",
    "--format=%(refname:short)%09%(HEAD)%09%(upstream:track)",
    "refs/heads",
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", head = "", track = ""] = line.split("\t");
      return { name, current: head === "*", upstreamGone: track === "[gone]" };
    });
}

/** worktree list 包括当前工作树和 linked worktree；分支引用保留完整 refs/heads/ 路径。 */
async function occupiedBranches(workdir: string): Promise<Set<string>> {
  const output = await git(workdir, ["worktree", "list", "--porcelain"]);
  return new Set(
    output.split("\n")
      .filter((line) => line.startsWith("branch refs/heads/"))
      .map((line) => line.slice("branch refs/heads/".length)),
  );
}

/** 仅在明确确认且全部远端 fetch --prune 成功后，清理已合并入当前 HEAD 的本地分支。 */
export async function cleanupBranches(workdir: string, confirmed: boolean): Promise<GitBranchCleanupResult> {
  const result: GitBranchCleanupResult = { ok: false, deleted: [], skipped: [] };
  if (confirmed !== true) {
    return { ...result, error: "删除分支前需要用户确认" };
  }

  try {
    const remotes = (await git(workdir, ["remote"])).split("\n").filter(Boolean);
    if (!remotes.length) {
      const branches = await listBranches(workdir);
      return {
        ...result,
        error: "仓库没有远端，未删除任何分支",
        skipped: branches.map(({ name, upstreamGone }) => ({ name, upstreamGone, reason: "no-remote" })),
      };
    }
  } catch (error) {
    return { ...result, error: describeGitError(error, "检查远端失败") };
  }

  try {
    await git(workdir, ["fetch", "--all", "--prune"]);
  } catch (error) {
    const message = describeGitError(error, "刷新远端失败，未删除任何分支");
    try {
      const branches = await listBranches(workdir);
      return {
        ...result,
        error: message,
        skipped: branches.map(({ name, upstreamGone }) => ({ name, upstreamGone, reason: "fetch-failed" })),
      };
    } catch {
      return { ...result, error: message };
    }
  }

  let branches: LocalBranch[];
  let occupied: Set<string>;
  let merged: Set<string>;
  try {
    branches = await listBranches(workdir);
    occupied = await occupiedBranches(workdir);
    const mergedOutput = await git(workdir, [
      "for-each-ref", "--merged=HEAD", "--format=%(refname:short)", "refs/heads",
    ]);
    merged = new Set(mergedOutput.split("\n").filter(Boolean));
  } catch (error) {
    return { ...result, error: describeGitError(error, "检查分支状态失败，未删除任何分支") };
  }

  const skipped: GitBranchCleanupSkipped[] = [];
  for (const branch of branches) {
    const { name, upstreamGone } = branch;
    if (branch.current) {
      skipped.push({ name, upstreamGone, reason: "current" });
    } else if (occupied.has(name)) {
      skipped.push({ name, upstreamGone, reason: "worktree" });
    } else if (!merged.has(name)) {
      skipped.push({ name, upstreamGone, reason: "unmerged" });
    } else {
      try {
        // branch -d 自带未合并保护；-- 防止分支名被当作选项。
        await git(workdir, ["branch", "-d", "--", name]);
        result.deleted.push({ name, upstreamGone });
      } catch (error) {
        skipped.push({ name, upstreamGone, reason: "delete-failed", error: describeGitError(error, "删除分支失败") });
      }
    }
  }
  return { ...result, ok: true, skipped };
}
