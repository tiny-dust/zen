import { ipcMain } from "electron";

import type { GitRepository } from "@zen/shared";

import { discoverGitRepositories } from "./git-discovery";
import { registerGitQueryIpc } from "./git-ipc-query";
import { registerGitRemoteIpc } from "./git-ipc-remote";
import { registerGitWriteIpc } from "./git-ipc-write";

export function registerGitIpc(): void {
  ipcMain.handle("git:discover", (_event, root: unknown): Promise<GitRepository[]> => {
    if (typeof root !== "string" || !root.trim()) {
      throw new Error("扫描目录不能为空");
    }
    return discoverGitRepositories(root);
  });
  registerGitQueryIpc();
  registerGitWriteIpc();
  registerGitRemoteIpc();
}
