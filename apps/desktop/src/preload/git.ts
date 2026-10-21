import { ipcRenderer } from "electron";

import type {
  GitBranches,
  GitCommitBatch,
  GitCommitDetail,
  GitLogEntry,
  GitPullRequest,
  GitStashEntry,
  GitStatus,
  GitSyncResult,
} from "@zen/shared";

/** 补全类任务（commit message 等）显式指定的模型：优先于全局选中 */
export interface GitCompletionModel {
  providerId?: string;
  modelId?: string;
}

export const gitApi = {
  git: {
    info(cwd?: string): Promise<{ repo: string; branch: string }> {
      return ipcRenderer.invoke("git:info", cwd);
    },
    status(cwd?: string): Promise<GitStatus | null> {
      return ipcRenderer.invoke("git:status", cwd);
    },
    diff(cwd: string | undefined, path: string, staged = false): Promise<string | null> {
      return ipcRenderer.invoke("git:diff", cwd, path, staged);
    },
    commit(
      cwd: string | undefined,
      message: string,
      files: string[],
      options?: {
        push?: boolean;
        includeUnstaged?: boolean;
        autoMessage?: boolean;
        model?: GitCompletionModel;
      },
    ): Promise<{ ok: boolean; error?: string; output?: string; message?: string; aiNote?: string }> {
      return ipcRenderer.invoke("git:commit", cwd, message, files, options);
    },
    log(cwd?: string, ref?: string): Promise<GitLogEntry[]> {
      return ipcRenderer.invoke("git:log", cwd, ref);
    },
    commitDetail(cwd: string | undefined, hash: string): Promise<GitCommitDetail | null> {
      return ipcRenderer.invoke("git:commit-detail", cwd, hash);
    },
    commitFileDiff(
      cwd: string | undefined,
      hash: string,
      path: string,
    ): Promise<string | null> {
      return ipcRenderer.invoke("git:commit-diff", cwd, hash, path);
    },
    commitBatched(
      cwd: string | undefined,
      files: string[],
      options?: { push?: boolean; model?: GitCompletionModel },
    ): Promise<{
      ok: boolean;
      batches: GitCommitBatch[];
      error?: string;
      /** AI 规划失败原因：非空表示批次是目录兜底分组而非按内容分组 */
      planNote?: string;
    }> {
      return ipcRenderer.invoke("git:commit-batched", cwd, files, options);
    },
    aiMessage(cwd?: string, model?: GitCompletionModel): Promise<string> {
      return ipcRenderer.invoke("git:ai-message", cwd, model);
    },
    createBranch(
      cwd: string | undefined,
      name: string,
      base?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("git:create-branch", cwd, name, base);
    },
    push(cwd?: string): Promise<{ ok: boolean; error?: string; output?: string }> {
      return ipcRenderer.invoke("git:push", cwd);
    },
    fetch(cwd?: string): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:fetch", cwd);
    },
    pull(cwd?: string): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:pull", cwd);
    },
    merge(cwd: string | undefined, branch: string): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:merge", cwd, branch);
    },
    mergeAbort(cwd?: string): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:merge-abort", cwd);
    },
    /** 撤回工作区改动：files 为空撤回全部（不可恢复，UI 侧需二次确认） */
    discard(cwd: string | undefined, files?: string[]): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:discard", cwd, files);
    },
    stashPush(cwd: string | undefined, message?: string): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:stash-push", cwd, message);
    },
    stashApply(cwd: string | undefined, index: number, mode?: "apply" | "pop"): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:stash-apply", cwd, index, mode);
    },
    stashList(cwd?: string): Promise<GitStashEntry[]> {
      return ipcRenderer.invoke("git:stash-list", cwd);
    },
    stashDrop(cwd: string | undefined, index: number): Promise<GitSyncResult> {
      return ipcRenderer.invoke("git:stash-drop", cwd, index);
    },
    branches(cwd?: string): Promise<GitBranches> {
      return ipcRenderer.invoke("git:branches", cwd);
    },
    checkout(
      cwd: string | undefined,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("git:checkout", cwd, name);
    },
    pr(cwd?: string): Promise<GitPullRequest | null> {
      return ipcRenderer.invoke("git:pr", cwd);
    },
  },
};
