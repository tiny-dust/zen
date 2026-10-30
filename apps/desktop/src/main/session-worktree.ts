import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { SessionWorktree } from "@zen/shared";

import { git } from "./git-exec";
import { getDb } from "./model-db-connection";
import { getSession, getWorkspace, hasSession } from "./workspace-db";
import { zenWorktreesRoot } from "./zen-dir";

interface WorktreeRow {
  session_id: string;
  project_path: string;
  repo_path: string;
  worktree_path: string;
  branch: string;
  created_at: number;
}

const pendingCreates = new Map<string, Promise<SessionWorktree>>();

function worktreePathFor(sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 20);
  return join(zenWorktreesRoot(), hash);
}

function projectPathInWorktree(row: WorktreeRow): string {
  const subdir = relative(row.repo_path, row.project_path);
  return join(row.worktree_path, subdir);
}

function assertManagedWorktree(row: WorktreeRow): void {
  if (resolve(row.worktree_path) !== worktreePathFor(row.session_id)) {
    throw new Error("会话工作树路径不在 Zen 管理目录内");
  }
  const subdir = relative(row.repo_path, row.project_path);
  if (isAbsolute(subdir) || subdir === ".." || subdir.startsWith(`..${sep}`)) {
    throw new Error("会话工作树绑定的项目路径无效");
  }
}

function toWorktree(row: WorktreeRow): SessionWorktree {
  return {
    sessionId: row.session_id,
    projectPath: row.project_path,
    repoPath: row.repo_path,
    worktreePath: row.worktree_path,
    path: projectPathInWorktree(row),
    branch: row.branch,
    createdAt: row.created_at,
  };
}

function findRow(sessionId: string): WorktreeRow | undefined {
  return getDb()
    .prepare("SELECT * FROM session_worktrees WHERE session_id = ?")
    .get(sessionId) as WorktreeRow | undefined;
}

/** 仅返回当前用户可见会话的绑定，不创建目录。 */
export function getSessionWorktree(sessionId: string): SessionWorktree | null {
  if (!hasSession(sessionId)) {
    return null;
  }
  const row = findRow(sessionId);
  if (!row) {
    return null;
  }
  assertManagedWorktree(row);
  return toWorktree(row);
}

export function hasWorktreeInWorkspace(workspaceId: string): boolean {
  return !!getDb()
    .prepare(`SELECT 1 FROM session_worktrees AS w
      JOIN chat_sessions AS s ON s.id = w.session_id
      WHERE s.workspace_id = ? LIMIT 1`)
    .get(workspaceId);
}

/** 运行时使用会话绑定目录；绑定损坏时拒绝回退到源目录，避免改错项目。 */
export async function resolveSessionWorktreeRoot(
  sessionId: string,
  projectPath: string,
): Promise<string | null> {
  const row = findRow(sessionId);
  if (!row) {
    return null;
  }
  assertManagedWorktree(row);
  const actualProjectPath = await realpath(projectPath);
  if (actualProjectPath !== row.project_path) {
    throw new Error("会话工作树属于另一个项目，请先移除工作树再切换工作区");
  }
  const path = projectPathInWorktree(row);
  if (!(await stat(path).catch(() => null))?.isDirectory()) {
    throw new Error("会话工作树已丢失，请先检查或恢复工作树");
  }
  return path;
}

async function createWorktree(sessionId: string): Promise<SessionWorktree> {
  const record = getSession(sessionId);
  if (!record) {
    throw new Error("会话不存在");
  }
  const projectPath = getWorkspace(record.session.workspaceId)?.path;
  if (!projectPath) {
    throw new Error("公共区会话不能创建 Git 工作树");
  }
  const projectRealPath = await realpath(projectPath);
  const existing = findRow(sessionId);
  if (existing) {
    if (existing.project_path !== projectRealPath) {
      throw new Error("会话工作树属于另一个项目");
    }
    await resolveSessionWorktreeRoot(sessionId, projectPath);
    return toWorktree(existing);
  }

  const repoRoot = await realpath((await git(projectRealPath, ["rev-parse", "--show-toplevel"])).trim());
  const subdir = relative(repoRoot, projectRealPath);
  if (isAbsolute(subdir) || subdir === ".." || subdir.startsWith(`..${sep}`)) {
    throw new Error("工作区目录不在 Git 仓库内");
  }
  const worktreePath = worktreePathFor(sessionId);
  if (await stat(worktreePath).catch(() => null)) {
    throw new Error("工作树目录已存在，请先检查该目录");
  }
  await mkdir(zenWorktreesRoot(), { recursive: true });
  // 移除工作树后保留旧分支，重建时用新后缀，避免覆盖旧提交。
  const branch = `zen/session-${createHash("sha256").update(sessionId).digest("hex").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);

  const row: WorktreeRow = {
    session_id: sessionId,
    project_path: projectRealPath,
    repo_path: repoRoot,
    worktree_path: worktreePath,
    branch,
    created_at: Date.now(),
  };
  try {
    getDb()
      .prepare(`INSERT INTO session_worktrees
        (session_id, project_path, repo_path, worktree_path, branch, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.session_id, row.project_path, row.repo_path, row.worktree_path, row.branch, row.created_at);
  } catch (error) {
    await git(repoRoot, ["worktree", "remove", worktreePath]).catch(() => undefined);
    throw error;
  }
  return toWorktree(row);
}

/** 同一会话并发点击只创建一次工作树。 */
export function createSessionWorktree(sessionId: string): Promise<SessionWorktree> {
  if (!sessionId?.trim()) {
    return Promise.reject(new Error("会话 ID 不能为空"));
  }
  const running = pendingCreates.get(sessionId);
  if (running) {
    return running;
  }
  const operation = createWorktree(sessionId).finally(() => pendingCreates.delete(sessionId));
  pendingCreates.set(sessionId, operation);
  return operation;
}

/** Git 自己验证目录是否干净；绝不使用 --force，保留分支与提交。 */
export async function removeSessionWorktree(sessionId: string): Promise<void> {
  await pendingCreates.get(sessionId);
  if (!hasSession(sessionId)) {
    throw new Error("会话不存在");
  }
  const row = findRow(sessionId);
  if (!row) {
    return;
  }
  assertManagedWorktree(row);
  const changes = await git(row.worktree_path, ["status", "--porcelain", "--untracked-files=all", "--ignored"]);
  if (changes.trim()) {
    throw new Error("工作树内仍有修改、未跟踪或忽略的文件，请先处理后再移除");
  }
  await git(row.repo_path, ["worktree", "remove", row.worktree_path]);
  getDb().prepare("DELETE FROM session_worktrees WHERE session_id = ?").run(sessionId);
}
