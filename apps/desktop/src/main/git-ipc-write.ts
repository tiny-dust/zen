import { ipcMain } from "electron";

import { fallbackCommitMessage, generateAiMessage, planBatches } from "./git-commit-ai";
import type { CompletionModel } from "./git-commit-ai";
import { git } from "./git-exec";
import { removeWorktree } from "./git-worktrees";

import type { GitCommitBatch, GitSyncResult, WorktreeRemoveResult } from "@zen/shared";

/** git 子进程失败时的可读信息（execFile 错误带 stderr） */
function gitErrorText(error: unknown, fallback: string): string {
  const err = error as { stderr?: string; message?: string };
  return err?.stderr?.trim() || err?.message || fallback;
}

/** 渲染层传来的路径过滤：去空去重，`-` 开头的路径会被 git 当旗标解析，直接拒绝 */
function sanitizePaths(paths: string[] | undefined): { paths: string[]; rejected: string[] } {
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const raw of paths ?? []) {
    const path = raw.trim();
    if (!path) {
      continue;
    }
    if (path.startsWith("-")) {
      rejected.push(path);
    } else if (!valid.includes(path)) {
      valid.push(path);
    }
  }
  return { paths: valid, rejected };
}

/** 暂存文件（git add）：工作区改动进暂存区，冲突文件 add 后即标记为已解决 */
export async function stageFiles(workdir: string, paths: string[]): Promise<GitSyncResult> {
  const { paths: list, rejected } = sanitizePaths(paths);
  if (rejected.length) {
    return { ok: false, error: `路径不合法：${rejected.join("、")}` };
  }
  if (!list.length) {
    return { ok: false, error: "没有选择要暂存的文件" };
  }
  try {
    await git(workdir, ["add", "--", ...list]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: gitErrorText(error, "暂存失败") };
  }
}

/** 取消暂存（保留工作区改动）：HEAD 存在时 reset 回 HEAD；首个提交前（unborn HEAD）
 *  没有可比对象，改用 rm --cached 把条目移出暂存区并保留磁盘文件 */
export async function unstageFiles(workdir: string, paths: string[]): Promise<GitSyncResult> {
  const { paths: list, rejected } = sanitizePaths(paths);
  if (rejected.length) {
    return { ok: false, error: `路径不合法：${rejected.join("、")}` };
  }
  if (!list.length) {
    return { ok: false, error: "没有选择要取消暂存的文件" };
  }
  try {
    const hasHead = await git(workdir, ["rev-parse", "--verify", "--quiet", "HEAD"])
      .then(() => true)
      .catch(() => false);
    await git(
      workdir,
      hasHead
        ? ["reset", "-q", "HEAD", "--", ...list]
        : ["rm", "--cached", "-r", "--quiet", "--ignore-unmatch", "--", ...list],
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: gitErrorText(error, "取消暂存失败") };
  }
}

export interface GitCommitOptions {
  push?: boolean;
  includeUnstaged?: boolean;
  autoMessage?: boolean;
  /** 只提交已暂存内容（VS Code 行为）：不再先 git add，暂存区为空时直接失败 */
  stagedOnly?: boolean;
  model?: CompletionModel;
}

export interface GitCommitResult {
  ok: boolean;
  error?: string;
  output?: string;
  message?: string;
  /** 提交信息走了兜底生成时的 AI 失败原因 */
  aiNote?: string;
}

/** 提交：stagedOnly 只提交暂存区；否则可选先把 files（缺省全部）加入暂存区再提交 */
export async function commitChanges(
  workdir: string,
  message: string,
  files: string[],
  options: GitCommitOptions = {},
): Promise<GitCommitResult> {
  const push = options.push ?? false;
  const stagedOnly = options.stagedOnly ?? false;
  const includeUnstaged = !stagedOnly && (options.includeUnstaged ?? true);
  const { paths, rejected } = sanitizePaths(files);
  if (rejected.length) {
    return { ok: false, error: `路径不合法：${rejected.join("、")}` };
  }
  let trimmed = (message ?? "").trim();
  /** AI 生成失败原因：提交继续走兜底，但要让用户知道为什么不是 AI 生成 */
  let aiNote = "";

  try {
    // 任意提交相关操作：空 message 一律现场生成（AI 优先，失败用变更摘要兜底）
    if (!trimmed && options.autoMessage !== false) {
      trimmed = (
        await generateAiMessage(workdir, options.model).catch((error: unknown) => {
          aiNote = error instanceof Error && error.message ? error.message : "模型调用失败";
          return "";
        })
      ).trim();
    }
    if (!trimmed && options.autoMessage !== false) {
      trimmed = await fallbackCommitMessage(workdir);
    }
    if (!trimmed) {
      return { ok: false, error: "提交信息不能为空" };
    }
    if (stagedOnly) {
      // 暂存区为空时明确失败：不偷偷 add 工作区改动（与 VS Code 提交语义一致）
      const staged = await git(workdir, ["diff", "--cached", "--name-only"]).catch(() => "");
      if (!staged.trim()) {
        return { ok: false, error: "暂存区为空：先暂存要提交的变更" };
      }
    } else if (includeUnstaged) {
      await git(workdir, ["add", "--", ...(paths.length ? paths : ["."])]);
    }
    const commitOut = await git(workdir, ["commit", "-m", trimmed]);
    if (push) {
      const pushOut = await pushWithUpstream(workdir);
      return {
        ok: true,
        message: trimmed,
        output: `${commitOut.trim()}\n${pushOut.trim()}`.trim(),
        ...(aiNote ? { aiNote } : {}),
      };
    }
    return { ok: true, message: trimmed, output: commitOut.trim(), ...(aiNote ? { aiNote } : {}) };
  } catch (error) {
    return { ok: false, error: gitErrorText(error, "提交失败") };
  }
}

/** 推送当前分支：-u 兼容首推（无上游时自动建立 tracking，已设置时幂等）。
 *  remote 名取仓库第一个 remote（通常 origin），无 remote 时回落普通 push 交由 git 报错 */
async function pushWithUpstream(workdir: string): Promise<string> {
  const remotes = await git(workdir, ["remote"]).catch(() => "");
  const remote = remotes.split("\n")[0]?.trim();
  return remote
    ? git(workdir, ["push", "-u", remote, "HEAD"])
    : git(workdir, ["push"]);
}

/** 写入组：stage / unstage / commit / push / checkout / commit-batched / ai-message / create-branch / worktree-remove */
export function registerGitWriteIpc(): void {
  ipcMain.handle(
    "git:stage",
    async (_event, cwd: string | undefined, paths: string[]): Promise<GitSyncResult> =>
      stageFiles(cwd || process.cwd(), paths),
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, cwd: string | undefined, paths: string[]): Promise<GitSyncResult> =>
      unstageFiles(cwd || process.cwd(), paths),
  );

  ipcMain.handle(
    "git:commit",
    async (
      _event,
      cwd: string | undefined,
      message: string,
      files: string[],
      options?: GitCommitOptions,
    ): Promise<GitCommitResult> => commitChanges(cwd || process.cwd(), message, files, options),
  );

  ipcMain.handle(
    "git:push",
    async (_event, cwd?: string): Promise<{ ok: boolean; error?: string; output?: string }> => {
      const workdir = cwd || process.cwd();
      try {
        const output = await pushWithUpstream(workdir);
        return { ok: true, output: output.trim() };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "推送失败" };
      }
    },
  );

  ipcMain.handle(
    "git:checkout",
    async (_event, cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }> => {
      const branch = name.trim();
      if (!branch) {
        return { ok: false, error: "分支名不能为空" };
      }
      const workdir = cwd || process.cwd();
      try {
        await git(workdir, ["checkout", branch]);
        return { ok: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "切换分支失败" };
      }
    },
  );

  /** 分批提交：按文件变更内容分组，每批独立 add + pathspec 限定 commit，最后统一 push */
  ipcMain.handle(
    "git:commit-batched",
    async (
      _event,
      cwd: string | undefined,
      files: string[],
      options?: { push?: boolean; model?: CompletionModel },
    ): Promise<{
      ok: boolean;
      batches: GitCommitBatch[];
      error?: string;
      /** AI 规划失败原因：非空表示批次是目录兜底分组而非按内容分组 */
      planNote?: string;
    }> => {
      const workdir = cwd || process.cwd();
      const candidates = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
      if (!candidates.length) {
        return { ok: false, batches: [], error: "没有可提交的文件" };
      }
      const candidateSet = new Set(candidates);
      const committed: GitCommitBatch[] = [];
      try {
        const { batches, note } = await planBatches(workdir, candidates, candidateSet, options?.model);
        for (const batch of batches) {
          // add 保证未跟踪文件入库；pathspec 限定 commit 只提交本批路径，不泄漏其它已暂存内容
          await git(workdir, ["add", "--", ...batch.files]);
          await git(workdir, ["commit", "-m", batch.message, "--", ...batch.files]);
          const hash = (await git(workdir, ["rev-parse", "--short", "HEAD"])).trim();
          committed.push({ message: batch.message, files: batch.files, hash });
        }
        if (!committed.length) {
          return { ok: false, batches: [], error: "没有生成有效的提交批次" };
        }
        if (options?.push) {
          await pushWithUpstream(workdir);
        }
        return { ok: true, batches: committed, ...(note ? { planNote: note } : {}) };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return {
          ok: false,
          batches: committed,
          error: err.stderr?.trim() || err.message || "分批提交失败",
        };
      }
    },
  );

  ipcMain.handle(
    "git:ai-message",
    async (_event, cwd?: string, model?: CompletionModel): Promise<string> => {
      const workdir = cwd || process.cwd();
      return generateAiMessage(workdir, model);
    },
  );

  ipcMain.handle(
    "git:create-branch",
    async (
      _event,
      cwd: string | undefined,
      name: string,
      base?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      const branch = name.trim();
      if (!branch || /[\s~^:?*[\\\u0000]/.test(branch)) {
        return { ok: false, error: "分支名不合法" };
      }
      // 可选基分支（本地或远程分支名）：checkout -b <new> <base>；缺省从当前 HEAD 创建
      const from = base?.trim();
      if (from && (/[\s~^:?*[\\\u0000]/.test(from) || from.startsWith("-"))) {
        return { ok: false, error: "基分支名不合法" };
      }
      const workdir = cwd || process.cwd();
      try {
        await git(workdir, from ? ["checkout", "-b", branch, from] : ["checkout", "-b", branch]);
        return { ok: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "创建分支失败" };
      }
    },
  );

  /** 删除链接工作树：主进程校验路径确实登记在该仓库，从不加 --force */
  ipcMain.handle(
    "git:worktree-remove",
    async (_event, repoPath: unknown, worktreePath: unknown): Promise<WorktreeRemoveResult> => {
      if (typeof repoPath !== "string" || typeof worktreePath !== "string") {
        return { ok: false, error: "仓库路径与工作树路径不能为空" };
      }
      return removeWorktree(repoPath, worktreePath);
    },
  );
}
