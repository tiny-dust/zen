import { ipcMain } from "electron";

import { fallbackCommitMessage, generateAiMessage, planBatches } from "./git-commit-ai";
import { git } from "./git-exec";

import type { GitCommitBatch } from "@zen/shared";

/** 推送当前分支：-u 兼容首推（无上游时自动建立 tracking，已设置时幂等）。
 *  remote 名取仓库第一个 remote（通常 origin），无 remote 时回落普通 push 交由 git 报错 */
async function pushWithUpstream(workdir: string): Promise<string> {
  const remotes = await git(workdir, ["remote"]).catch(() => "");
  const remote = remotes.split("\n")[0]?.trim();
  return remote
    ? git(workdir, ["push", "-u", remote, "HEAD"])
    : git(workdir, ["push"]);
}

/** 写入组：commit / push / checkout / commit-batched / ai-message / create-branch */
export function registerGitWriteIpc(): void {
  ipcMain.handle(
    "git:commit",
    async (
      _event,
      cwd: string | undefined,
      message: string,
      files: string[],
      options?: { push?: boolean; includeUnstaged?: boolean; autoMessage?: boolean },
    ): Promise<{ ok: boolean; error?: string; output?: string; message?: string }> => {
      const workdir = cwd || process.cwd();
      const push = options?.push ?? false;
      const includeUnstaged = options?.includeUnstaged ?? true;
      let trimmed = (message ?? "").trim();

      try {
        // 任意提交相关操作：空 message 一律现场生成（AI 优先，失败用变更摘要兜底）
        if (!trimmed && options?.autoMessage !== false) {
          trimmed = (await generateAiMessage(workdir).catch(() => "")).trim();
        }
        if (!trimmed && options?.autoMessage !== false) {
          trimmed = await fallbackCommitMessage(workdir);
        }
        if (!trimmed) {
          return { ok: false, error: "提交信息不能为空" };
        }
        if (includeUnstaged) {
          await git(workdir, ["add", "--", ...(files.length ? files : ["."])]);
        }
        const commitOut = await git(workdir, ["commit", "-m", trimmed]);
        if (push) {
          const pushOut = await pushWithUpstream(workdir);
          return {
            ok: true,
            message: trimmed,
            output: `${commitOut.trim()}\n${pushOut.trim()}`.trim(),
          };
        }
        return { ok: true, message: trimmed, output: commitOut.trim() };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "提交失败" };
      }
    },
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
      options?: { push?: boolean },
    ): Promise<{ ok: boolean; batches: GitCommitBatch[]; error?: string }> => {
      const workdir = cwd || process.cwd();
      const candidates = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
      if (!candidates.length) {
        return { ok: false, batches: [], error: "没有可提交的文件" };
      }
      const candidateSet = new Set(candidates);
      const committed: GitCommitBatch[] = [];
      try {
        const plan = await planBatches(workdir, candidates, candidateSet);
        for (const batch of plan) {
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
        return { ok: true, batches: committed };
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

  ipcMain.handle("git:ai-message", async (_event, cwd?: string): Promise<string> => {
    const workdir = cwd || process.cwd();
    return generateAiMessage(workdir);
  });

  ipcMain.handle(
    "git:create-branch",
    async (_event, cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }> => {
      const branch = name.trim();
      if (!branch || /[\s~^:?*[\\\u0000]/.test(branch)) {
        return { ok: false, error: "分支名不合法" };
      }
      const workdir = cwd || process.cwd();
      try {
        await git(workdir, ["checkout", "-b", branch]);
        return { ok: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "创建分支失败" };
      }
    },
  );
}
