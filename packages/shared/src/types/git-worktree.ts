/**
 * 仓库级 worktree 列表（`git worktree list --porcelain`）：
 * 除了会话绑定的那一条，也包含 Agent 或其他工具在该仓库里创建的链接工作树。
 */

export type RepoWorktreeKind = "main" | "linked";

export interface RepoWorktree {
  /** 工作树目录绝对路径（缺失时是 Git 登记里记的路径） */
  path: string;
  /** 分支短名；分离头指针时为 `detached@<sha7>` */
  branch: string;
  head: string;
  kind: RepoWorktreeKind;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason?: string;
  /** Git 认为可被 prune（目录已丢失或损坏） */
  prunable: boolean;
  /** 目录当前确实不存在 */
  missing: boolean;
  /** 绑定到 Zen 会话时给出会话 id（Zen 管理的标记） */
  sessionId?: string;
  /** 就是当前会话正在使用的执行目录 */
  current: boolean;
  /** 可在此路径上做 Git 操作（丢失 / bare 时不可） */
  operable: boolean;
  /** 不可删除的原因（主进程已排好的短句，界面直接显示） */
  blockedReason?: string;
}

export interface RepoWorktreeList {
  repoPath: string;
  repoName: string;
  worktrees: RepoWorktree[];
}

export interface WorktreeListResult {
  repos: RepoWorktreeList[];
  error?: string;
}

export interface WorktreeRemoveResult {
  ok: boolean;
  error?: string;
  /** 仅清理了 Git 登记（目录已丢失） */
  pruned?: boolean;
}
