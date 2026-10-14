import { ipcMain } from "electron";

import { resolveWorkdir } from "./git-exec";
import {
  abortMerge,
  fetchRemote,
  mergeBranch,
  pullRemote,
  stashApply,
  stashDrop,
  stashList,
  stashPush,
} from "./git-remote";

/** 远端同步组：fetch / pull / merge（含 abort）/ stash；纯逻辑在 git-remote.ts（可单测） */
export function registerGitRemoteIpc(): void {
  ipcMain.handle("git:fetch", async (_event, cwd?: string): Promise<ReturnType<typeof fetchRemote>> =>
    fetchRemote(resolveWorkdir(cwd)),
  );

  ipcMain.handle("git:pull", async (_event, cwd?: string): Promise<ReturnType<typeof pullRemote>> =>
    pullRemote(resolveWorkdir(cwd)),
  );

  ipcMain.handle(
    "git:merge",
    async (
      _event,
      cwd: string | undefined,
      branch: string,
    ): Promise<ReturnType<typeof mergeBranch>> => mergeBranch(resolveWorkdir(cwd), branch),
  );

  ipcMain.handle(
    "git:merge-abort",
    async (_event, cwd?: string): Promise<ReturnType<typeof abortMerge>> =>
      abortMerge(resolveWorkdir(cwd)),
  );

  ipcMain.handle(
    "git:stash-push",
    async (
      _event,
      cwd: string | undefined,
      message?: string,
    ): Promise<ReturnType<typeof stashPush>> => stashPush(resolveWorkdir(cwd), message),
  );

  ipcMain.handle(
    "git:stash-apply",
    async (
      _event,
      cwd: string | undefined,
      index: number,
      mode?: "apply" | "pop",
    ): Promise<ReturnType<typeof stashApply>> => stashApply(resolveWorkdir(cwd), index, mode ?? "apply"),
  );

  ipcMain.handle(
    "git:stash-list",
    async (_event, cwd?: string): Promise<ReturnType<typeof stashList>> =>
      stashList(resolveWorkdir(cwd)),
  );

  ipcMain.handle(
    "git:stash-drop",
    async (
      _event,
      cwd: string | undefined,
      index: number,
    ): Promise<ReturnType<typeof stashDrop>> => stashDrop(resolveWorkdir(cwd), index),
  );
}
