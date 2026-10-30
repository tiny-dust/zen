import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionWorktree,
  getSessionWorktree,
  removeSessionWorktree,
  resolveSessionWorktreeRoot,
} from "./session-worktree";

let conn: Database.Database;
let projectPath: string;
let worktreesRoot: string;
let tempRoot: string;
const sessions = new Set<string>();

vi.mock("./model-db-connection", () => ({ getDb: () => conn }));
vi.mock("./workspace-db", () => ({
  getSession: (id: string) => sessions.has(id) ? { session: { workspaceId: "project" } } : undefined,
  hasSession: (id: string) => sessions.has(id),
  getWorkspace: (id: string) => id === "project" ? { path: projectPath } : undefined,
}));
vi.mock("./zen-dir", () => ({ zenWorktreesRoot: () => worktreesRoot }));

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "zen-worktree-test-"));
  projectPath = join(tempRoot, "project");
  worktreesRoot = join(tempRoot, "worktrees");
  await mkdir(projectPath);
  runGit(projectPath, "init", "-q");
  await writeFile(join(projectPath, "readme.txt"), "original\n");
  runGit(projectPath, "add", "readme.txt");
  runGit(projectPath, "-c", "user.name=Zen Test", "-c", "user.email=zen@test.local", "commit", "-qm", "initial");
  conn = new Database(":memory:");
  conn.exec(`CREATE TABLE session_worktrees (
    session_id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  sessions.clear();
  sessions.add("session-one");
  sessions.add("session-two");
});

afterEach(async () => {
  conn.close();
  await rm(tempRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("会话 Git worktree", () => {
  it("为不同会话创建独立工作树，并在后续轮次复用各自目录", async () => {
    const [first, concurrent] = await Promise.all([
      createSessionWorktree("session-one"),
      createSessionWorktree("session-one"),
    ]);
    expect(concurrent).toEqual(first);
    const second = await createSessionWorktree("session-two");
    expect(first.worktreePath).not.toBe(second.worktreePath);
    expect(first.path).toBe(first.worktreePath);
    expect(await resolveSessionWorktreeRoot("session-one", projectPath)).toBe(first.path);
    expect(await createSessionWorktree("session-one")).toEqual(first);
    expect(getSessionWorktree("session-two")).toEqual(second);

    await writeFile(join(first.path, "readme.txt"), "session one\n");
    expect(await readFile(join(second.path, "readme.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(projectPath, "readme.txt"), "utf8")).toBe("original\n");
  });

  it("有未提交改动时拒绝移除；清理后可重建且保留旧分支", async () => {
    const first = await createSessionWorktree("session-one");
    await writeFile(join(first.path, "readme.txt"), "changed\n");
    await expect(removeSessionWorktree("session-one")).rejects.toThrow("仍有修改");
    expect(getSessionWorktree("session-one")?.path).toBe(first.path);

    runGit(first.path, "restore", "readme.txt");
    await mkdir(join(first.path, "node_modules"));
    await writeFile(join(first.path, "node_modules", "cache.txt"), "local data");
    await expect(removeSessionWorktree("session-one")).rejects.toThrow("未跟踪");
    await rm(join(first.path, "node_modules"), { recursive: true });
    await removeSessionWorktree("session-one");
    expect(getSessionWorktree("session-one")).toBeNull();
    const next = await createSessionWorktree("session-one");
    expect(next.branch).not.toBe(first.branch);
    expect(runGit(projectPath, "branch", "--list", first.branch)).toContain(first.branch);
  });

  it("项目绑定不匹配或目录丢失时拒绝回退到源目录", async () => {
    const first = await createSessionWorktree("session-one");
    const another = join(tempRoot, "another");
    await mkdir(another);
    await expect(resolveSessionWorktreeRoot("session-one", another)).rejects.toThrow("另一个项目");
    await rm(first.worktreePath, { recursive: true, force: true });
    await expect(resolveSessionWorktreeRoot("session-one", projectPath)).rejects.toThrow("已丢失");
  });
});
