import { registerGitQueryIpc } from "./git-ipc-query";
import { registerGitWriteIpc } from "./git-ipc-write";

export function registerGitIpc(): void {
  registerGitQueryIpc();
  registerGitWriteIpc();
}
