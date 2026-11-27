import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 主进程模块在导入期读 electron / 数据库：测试替换成内存库并记录 IPC handler
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  app: { getPath: () => "" },
}));
vi.mock("./git-commit-ai", () => ({
  fallbackCommitMessage: vi.fn(async () => ""),
  generateAiMessage: vi.fn(async () => ""),
  planBatches: vi.fn(),
}));
vi.mock("./model-db-connection", () => ({ getDb: () => conn }));
vi.mock("./zen-dir", () => ({ zenWorktreesRoot: () => worktreesRoot }));
const sessions = new Set<string>();
vi.mock("./workspace-db", () => ({
  hasSession: (id: string) => sessions.has(id),
  getSession: () => undefined,
  getWorkspace: () => undefined,
}));

import { listRepoWorktrees, removeWorktree } from "./git-worktrees";
import { registerGitQueryIpc } from "./git-ipc-query";
import { registerGitWriteIpc } from "./git-ipc-write";
import { findSessionIdByWorktreePath } from "./session-worktree";

import type { RepoWorktree, WorktreeListResult } from "@zen/shared";

registerGitQueryIpc();
registerGitWriteIpc();

let conn: Database.Database;
let base: string;
let repo: string;
let worktreesRoot: string;

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function addWorktree(path: string, branch: string): void {
  runGit(repo, "worktree", "add", "-q", path, "-b", branch);
}

async function worktreesOf(repoPath = repo): Promise<RepoWorktree[]> {
  const result = await listRepoWorktrees(repoPath);
  return result.repos[0]?.worktrees ?? [];
}

async function findByPath(path: string): Promise<RepoWorktree | undefined> {
  const target = resolve(path);
  return (await worktreesOf()).find((item) => item.path === target);
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册的 channel：${channel}`);
  return Promise.resolve(handler({}, ...args)) as Promise<T>;
}

beforeEach(async () => {
  // realpath 消除 macOS /var -> /private/var：Git 输出的工作树路径是真实路径
  base = await realpath(await mkdtemp(join(tmpdir(), "zen-worktrees-")));
  repo = join(base, "repo with space");
  worktreesRoot = join(base, "zen-worktrees");
  await mkdir(repo, { recursive: true });
  runGit(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "readme.txt"), "base\n");
  runGit(repo, "add", "readme.txt");
  runGit(repo, "-c", "user.name=Zen Test", "-c", "user.email=zen@test.local", "commit", "-qm", "init");

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
});

afterEach(async () => {
  conn.close();
  await rm(base, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("仓库工作树列表", () => {
  it("列出主工作树与全部链接工作树（含空格路径、detached、current）", async () => {
    const linked = join(base, "linked one");
    const detached = join(base, "detached-wt");
    addWorktree(linked, "feat/one");
    runGit(repo, "worktree", "add", "-q", "--detach", detached, "HEAD");

    const result = await listRepoWorktrees(repo, linked);
    expect(result.error).toBeUndefined();
    expect(result.repos).toHaveLength(1);
    const [repoList] = result.repos;
    expect(repoList).toMatchObject({ repoPath: repo, repoName: "repo with space" });
    expect(repoList?.worktrees).toHaveLength(3);

    const main = repoList?.worktrees.find((item) => item.kind === "main");
    expect(main).toMatchObject({
      path: repo,
      branch: "main",
      kind: "main",
      bare: false,
      locked: false,
      missing: false,
      current: false,
      operable: true,
      blockedReason: "主工作树不能删除",
    });

    const one = repoList?.worktrees.find((item) => item.path === resolve(linked));
    expect(one).toMatchObject({
      path: linked,
      branch: "feat/one",
      kind: "linked",
      detached: false,
      current: true,
      operable: true,
    });
    expect(one?.sessionId).toBeUndefined();
    expect(one?.blockedReason).toBeUndefined();

    const det = await findByPath(detached);
    expect(det).toMatchObject({ kind: "linked", detached: true });
    expect(det?.branch).toMatch(/^detached@[0-9a-f]{7}$/);
  });

  it("按仓库子目录查询时也返回主工作树路径与全部工作树", async () => {
    await mkdir(join(repo, "sub"));
    addWorktree(join(base, "linked-two"), "feat/two");

    const result = await listRepoWorktrees(join(repo, "sub"));
    expect(result.repos[0]).toMatchObject({ repoPath: repo, repoName: "repo with space" });
    expect(result.repos[0]?.worktrees).toHaveLength(2);
  });

  it("锁定与目录丢失：标记 locked / missing / prunable 并给出不可删除原因", async () => {
    const locked = join(base, "locked-wt");
    const gone = join(base, "gone-wt");
    addWorktree(locked, "feat/locked");
    addWorktree(gone, "feat/gone");
    runGit(repo, "worktree", "lock", "--reason", "busy here", locked);
    await rm(gone, { recursive: true, force: true });

    const lockedEntry = await findByPath(locked);
    expect(lockedEntry).toMatchObject({
      locked: true,
      lockReason: "busy here",
      missing: false,
      operable: true,
      blockedReason: "该工作树已锁定（busy here）",
    });

    const goneEntry = await findByPath(gone);
    expect(goneEntry).toMatchObject({
      missing: true,
      prunable: true,
      operable: false,
      blockedReason: "目录已丢失，仅可清理 Git 登记",
    });
  });

  it("不是 Git 仓库时返回错误而不抛异常", async () => {
    const plain = join(base, "plain");
    await mkdir(plain);
    const result = await listRepoWorktrees(plain);
    expect(result.repos).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe("删除工作树", () => {
  it("成功删除干净工作树：列表少一条，分支与提交保留", async () => {
    const linked = join(base, "done-wt");
    addWorktree(linked, "feat/done");

    await expect(removeWorktree(repo, linked)).resolves.toEqual({ ok: true });
    await expect(stat(linked)).rejects.toBeTruthy();
    expect((await worktreesOf()).some((item) => item.path === resolve(linked))).toBe(false);
    expect(runGit(repo, "branch", "--list", "feat/done")).toContain("feat/done");
  });

  it("拒绝删除有修改/未跟踪/忽略文件的工作树，目录与登记都保留", async () => {
    const linked = join(base, "dirty-wt");
    addWorktree(linked, "feat/dirty");
    await writeFile(join(linked, "dirty.txt"), "uncommitted\n");

    const result = await removeWorktree(repo, linked);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("仍有修改");
    expect((await stat(linked)).isDirectory()).toBe(true);
    expect((await worktreesOf()).some((item) => item.path === resolve(linked))).toBe(true);

    // 忽略文件同样阻止删除：Git 判定目录不干净时绝不带 --force
    await rm(join(linked, "dirty.txt"));
    await writeFile(join(linked, ".gitignore"), "ignored/\n");
    runGit(linked, "add", ".gitignore");
    runGit(linked, "-c", "user.name=Zen Test", "-c", "user.email=zen@test.local", "commit", "-qm", "ignore");
    await mkdir(join(linked, "ignored"));
    await writeFile(join(linked, "ignored", "cache.txt"), "local data\n");

    const ignoredResult = await removeWorktree(repo, linked);
    expect(ignoredResult.ok).toBe(false);
    expect(ignoredResult.error).toContain("仍有修改");
    expect((await stat(linked)).isDirectory()).toBe(true);
  });

  it("拒绝主工作树、相对路径与非登记路径，不删仓库外目录", async () => {
    const outsider = join(base, "outside");
    await mkdir(outsider);
    await writeFile(join(outsider, "keep.txt"), "keep\n");

    await expect(removeWorktree(repo, repo)).resolves.toMatchObject({
      ok: false,
      error: "主工作树不能删除",
    });
    await expect(removeWorktree(repo, "relative/path")).resolves.toMatchObject({
      ok: false,
      error: "仓库路径与工作树路径必须是绝对路径",
    });
    await expect(removeWorktree(repo, outsider)).resolves.toMatchObject({
      ok: false,
      error: "该目录不是这个仓库登记的工作树",
    });
    await expect(stat(join(outsider, "keep.txt"))).resolves.toBeTruthy();
  });

  it("目录已丢失时只清理 Git 登记，分支保留", async () => {
    const gone = join(base, "gone-wt");
    addWorktree(gone, "feat/gone");
    await rm(gone, { recursive: true, force: true });

    await expect(removeWorktree(repo, gone)).resolves.toEqual({ ok: true, pruned: true });
    expect((await worktreesOf()).some((item) => item.path === resolve(gone))).toBe(false);
    expect(runGit(repo, "branch", "--list", "feat/gone")).toContain("feat/gone");
  });

  it("锁定工作树拒绝删除并带出锁原因", async () => {
    const locked = join(base, "locked-wt");
    addWorktree(locked, "feat/locked");
    runGit(repo, "worktree", "lock", "--reason", "busy here", locked);

    const result = await removeWorktree(repo, locked);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("该工作树已锁定（busy here）");
    expect((await stat(locked)).isDirectory()).toBe(true);
  });

  it("Zen 绑定的工作树委托现有移除逻辑并清理绑定记录", async () => {
    const sessionId = "session-one";
    sessions.add(sessionId);
    const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 20);
    const zenPath = join(worktreesRoot, hash);
    await mkdir(worktreesRoot, { recursive: true });
    runGit(repo, "worktree", "add", "-q", zenPath, "-b", "zen/session-one");
    conn
      .prepare(
        `INSERT INTO session_worktrees
          (session_id, project_path, repo_path, worktree_path, branch, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, repo, repo, zenPath, "zen/session-one", Date.now());

    expect((await findByPath(zenPath))?.sessionId).toBe(sessionId);
    expect(findSessionIdByWorktreePath(zenPath)).toBe(sessionId);

    await expect(removeWorktree(repo, zenPath)).resolves.toEqual({ ok: true });
    await expect(stat(zenPath)).rejects.toBeTruthy();
    expect(conn.prepare("SELECT COUNT(*) AS n FROM session_worktrees").get()).toMatchObject({ n: 0 });
  });
});

describe("IPC 参数", () => {
  it("git:worktrees 支持单个路径、数组与空参数，并合并错误", async () => {
    addWorktree(join(base, "linked-ipc"), "feat/ipc");

    const single = await invoke<WorktreeListResult>("git:worktrees", repo);
    expect(single.repos).toHaveLength(1);
    expect(single.error).toBeUndefined();

    const empty = await invoke<WorktreeListResult>("git:worktrees");
    expect(empty).toEqual({ repos: [] });
    const junk = await invoke<WorktreeListResult>("git:worktrees", 42);
    expect(junk).toEqual({ repos: [] });

    const mixed = await invoke<WorktreeListResult>("git:worktrees", [repo, join(base, "missing-repo")]);
    expect(mixed.repos).toHaveLength(1);
    expect(mixed.error).toBeTruthy();
  });

  it("git:worktrees 透传当前会话路径，git:worktree-remove 校验参数类型", async () => {
    const linked = join(base, "current-wt");
    addWorktree(linked, "feat/current");

    const listed = await invoke<WorktreeListResult>("git:worktrees", repo, linked);
    expect(listed.repos[0]?.worktrees.find((item) => item.path === resolve(linked))?.current).toBe(true);

    await expect(invoke("git:worktree-remove", repo, "relative")).resolves.toMatchObject({
      ok: false,
      error: "仓库路径与工作树路径必须是绝对路径",
    });
    await expect(invoke("git:worktree-remove", repo, 123)).resolves.toMatchObject({
      ok: false,
      error: "仓库路径与工作树路径不能为空",
    });
  });
});
