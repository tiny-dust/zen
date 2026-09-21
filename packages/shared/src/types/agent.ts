export * from "./agent-events";
export * from "./agent-chat";

export interface WorkspaceFile {
  path: string;
  name: string;
  isDir: boolean;
}

/** 文件树懒加载：单层目录条目 */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ReadFileResult {
  content: string;
  size: number;
  truncated: boolean;
}

/** git status --porcelain 的文件级变更（X=暂存区，Y=工作区） */
export interface GitFileChange {
  path: string;
  x: string;
  y: string;
  add: number;
  del: number;
  untracked: boolean;
}

export interface GitStatus {
  branch: string;
  files: GitFileChange[];
  /** 待推送：本地领先上游的提交数；无上游分支时缺省 */
  ahead?: number;
  /** 落后远程：本地落后上游的提交数；无上游分支时缺省 */
  behind?: number;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
  /** %D 装饰：HEAD -> 分支、远端分支、tag 等（图谱分支徽标） */
  refs: string[];
}

/** 单个提交的变更文件（diff-tree name-status + numstat 合并，按首父对比） */
export interface GitCommitFile {
  path: string;
  /** A/M/D/T 等原始状态字母 */
  status: string;
  add: number;
  del: number;
}

/** 单个提交的完整信息（图谱展开详情） */
export interface GitCommitDetail {
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  committer: string;
  committerEmail: string;
  authorTime: number;
  committerTime: number;
  subject: string;
  /** 完整提交信息（含正文） */
  body: string;
  files: GitCommitFile[];
}

/** 分批提交的单批结果；失败批次 hash 为空 */
export interface GitCommitBatch {
  message: string;
  files: string[];
  hash: string;
}

/** 本地/远程分支条目 */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  /** 远程分支的 remote 名，如 origin */
  remote?: string;
}

export interface GitBranches {
  local: GitBranchInfo[];
  remote: GitBranchInfo[];
}

/** 当前分支关联的 PR（无则为 null） */
export interface GitPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
}

export const BUILTIN_SKILLS: Array<{ id: string; label: string; description: string }> = [
  { id: "commit-helper", label: "Commit Helper", description: "按仓库规范生成提交信息" },
];
