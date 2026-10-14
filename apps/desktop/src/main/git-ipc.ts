import { registerGitQueryIpc } from "./git-ipc-query";
import { registerGitRemoteIpc } from "./git-ipc-remote";
import { registerGitWriteIpc } from "./git-ipc-write";

export function registerGitIpc(): void {
  registerGitQueryIpc();
  registerGitWriteIpc();
  registerGitRemoteIpc();
}
