import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 2_000;

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function gitError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { stderr?: string; killed?: boolean; message?: string };
    if (e.killed) {
      return "git 命令超时（30s）";
    }
    if (e.stderr?.trim()) {
      return truncate(e.stderr, 500);
    }
  }
  return truncate(error instanceof Error ? error.message : String(error), 500);
}

async function git(cwd: string, args: string[]): Promise<string> {
  // execFile 不经 shell；timeout 防卡死；只做本地操作（add/commit/checkout/status 等），无 push/pull
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/** 分支名白名单：字母/数字开头，仅限 [A-Za-z0-9._/-]，防把选项注入 git 命令 */
export function isSafeBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && name.length <= 200;
}

export interface BranchListResult {
  current: string;
  branches: string[];
}

/** 本地分支清单（当前分支单独标出；detached HEAD 原样作为一个条目） */
export async function listBranches(projectPath: string): Promise<BranchListResult> {
  const out = await git(projectPath, ["branch", "--list"]);
  const branches: string[] = [];
  let current = "";
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (line.startsWith("* ")) {
      current = trimmed.slice(2).trim();
      branches.push(current);
    } else {
      branches.push(trimmed);
    }
  }
  return { current, branches };
}

export interface CheckoutResult {
  ok: boolean;
  /** true = 因工作区有未提交变更被拒绝 */
  dirty?: boolean;
  error?: string;
}

/** 切换本地分支：工作区脏时拒绝（避免丢代码），分支不存在时报错，不建新分支 */
export async function checkoutBranch(projectPath: string, branch: string): Promise<CheckoutResult> {
  try {
    const status = await git(projectPath, ["status", "--porcelain"]);
    if (status.trim()) {
      return { ok: false, dirty: true, error: `工作区有未提交变更：\n${truncate(status, 400)}` };
    }
    if (!isSafeBranchName(branch)) {
      return { ok: false, error: `分支名不合法：${truncate(branch, 60)}` };
    }
    try {
      await git(projectPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    } catch {
      return { ok: false, error: `本地分支不存在：${branch}` };
    }
    await git(projectPath, ["checkout", branch]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: gitError(error) };
  }
}

export interface CommitResult {
  ok: boolean;
  /** true = 没有可提交的变更 */
  clean?: boolean;
  summary?: string;
  error?: string;
}

/** add -A + commit（说明尾部注明 via Zen/飞书）；无变更时提示 */
export async function commitAll(projectPath: string, message: string): Promise<CommitResult> {
  try {
    const status = await git(projectPath, ["status", "--porcelain"]);
    if (!status.trim()) {
      return { ok: false, clean: true, error: "没有可提交的变更" };
    }
    await git(projectPath, ["add", "-A"]);
    await git(projectPath, ["commit", "-m", `${message}\n\nvia Zen/飞书`]);
    const summary = await git(projectPath, ["log", "-1", "--oneline", "--shortstat"]);
    return { ok: true, summary: truncate(summary) };
  } catch (error) {
    return { ok: false, error: gitError(error) };
  }
}
