import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 主进程模块在导入期读 electron.app / ipcMain：测试只跑导出的纯逻辑，直接替换 electron。
// 记录注册的 handler，用于顺带验证 git:status / git:diff 的侧别语义。
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));
// 提交信息生成依赖模型与数据库，测试里不关心：固定返回兜底文案
vi.mock("./git-commit-ai", () => ({
  fallbackCommitMessage: vi.fn(async () => "chore: fallback"),
  generateAiMessage: vi.fn(async () => ""),
  planBatches: vi.fn(),
}));

import { git } from "./git-exec";
import { registerGitQueryIpc } from "./git-ipc-query";
import { commitChanges, stageFiles, unstageFiles } from "./git-ipc-write";

registerGitQueryIpc();

/** 通过真实 handler 调用 IPC（event 参数在只读/写入逻辑里未使用） */
function invoke<T>(channel: string, workdir: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册的 channel：${channel}`);
  return Promise.resolve(handler({}, workdir, ...args)) as Promise<T>;
}

let repo: string;

async function initRepo(): Promise<void> {
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Zen Test"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
}

async function commitAll(message: string): Promise<void> {
  await git(repo, ["add", "--", "."]);
  await git(repo, ["commit", "-q", "-m", message]);
}

/** porcelain v1：x = 暂存区状态，y = 工作区状态 */
async function porcelain(): Promise<{ x: string; y: string; path: string }[]> {
  const output = await git(repo, ["-c", "core.quotepath=false", "status", "--porcelain", "-uall"]);
  return output
    .split("\n")
    .filter((line) => line.length >= 4)
    .map((line) => ({ x: line[0] ?? " ", y: line[1] ?? " ", path: line.slice(3) }));
}

async function entryOf(path: string) {
  return (await porcelain()).find((item) => item.path === path);
}

async function committedPaths(): Promise<string[]> {
  const output = await git(repo, ["show", "--pretty=format:", "--name-only", "HEAD"]);
  return output.split("\n").filter(Boolean);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "zen-git-stage-"));
  await initRepo();
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("git stage / unstage", () => {
  it("stage 单文件只暂存目标文件，多文件一次暂存", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await writeFile(join(repo, "b.txt"), "b1\n");
    await commitAll("init");
    await writeFile(join(repo, "a.txt"), "a2\n");
    await writeFile(join(repo, "b.txt"), "b2\n");

    await expect(stageFiles(repo, ["a.txt"])).resolves.toEqual({ ok: true });
    expect(await entryOf("a.txt")).toMatchObject({ x: "M", y: " " });
    expect(await entryOf("b.txt")).toMatchObject({ x: " ", y: "M" });

    await expect(stageFiles(repo, ["a.txt", "b.txt"])).resolves.toEqual({ ok: true });
    expect(await entryOf("b.txt")).toMatchObject({ x: "M", y: " " });
  });

  it("unstage 把文件移出暂存区并保留工作区改动", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await commitAll("init");
    await writeFile(join(repo, "a.txt"), "a2\n");
    await stageFiles(repo, ["a.txt"]);
    expect(await entryOf("a.txt")).toMatchObject({ x: "M", y: " " });

    await expect(unstageFiles(repo, ["a.txt"])).resolves.toEqual({ ok: true });
    expect(await entryOf("a.txt")).toMatchObject({ x: " ", y: "M" });
    await expect(readFile(join(repo, "a.txt"), "utf8")).resolves.toBe("a2\n");
  });

  it("首个提交前（unborn HEAD）取消暂存：退回未跟踪且保留文件", async () => {
    await writeFile(join(repo, "new.txt"), "hello\n");
    await stageFiles(repo, ["new.txt"]);
    expect(await entryOf("new.txt")).toMatchObject({ x: "A" });

    await expect(unstageFiles(repo, ["new.txt"])).resolves.toEqual({ ok: true });
    expect(await entryOf("new.txt")).toMatchObject({ x: "?", y: "?" });
    await expect(readFile(join(repo, "new.txt"), "utf8")).resolves.toBe("hello\n");
  });

  it("拒绝以 - 开头的路径（避免被 git 当旗标解析），空路径列表直接失败", async () => {
    await expect(stageFiles(repo, ["-n"])).resolves.toMatchObject({ ok: false });
    await expect(unstageFiles(repo, ["--hard"])).resolves.toMatchObject({ ok: false });
    await expect(stageFiles(repo, [])).resolves.toMatchObject({ ok: false });
    await expect(unstageFiles(repo, ["  "])).resolves.toMatchObject({ ok: false });
  });

  it("暂存不存在的文件时把 git 错误原样带回", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await commitAll("init");
    const result = await stageFiles(repo, ["missing.txt"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing.txt");
  });
});

describe("commitChanges stagedOnly", () => {
  it("只提交暂存内容，工作区其它改动保持未暂存", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await writeFile(join(repo, "b.txt"), "b1\n");
    await commitAll("init");
    await writeFile(join(repo, "a.txt"), "a2\n");
    await writeFile(join(repo, "b.txt"), "b2\n");
    await stageFiles(repo, ["a.txt"]);

    const result = await commitChanges(repo, "feat: only a", [], { stagedOnly: true });
    expect(result).toMatchObject({ ok: true, message: "feat: only a" });
    expect(await committedPaths()).toEqual(["a.txt"]);
    expect(await entryOf("a.txt")).toBeUndefined();
    expect(await entryOf("b.txt")).toMatchObject({ x: " ", y: "M" });
    await expect(readFile(join(repo, "b.txt"), "utf8")).resolves.toBe("b2\n");
  });

  it("暂存区为空时失败，不偷偷把工作区改动加入暂存区", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await commitAll("init");
    await writeFile(join(repo, "a.txt"), "a2\n");
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();

    const result = await commitChanges(repo, "chore: nothing staged", [], { stagedOnly: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("暂存区为空");
    expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(head);
    expect(await entryOf("a.txt")).toMatchObject({ x: " ", y: "M" });
  });

  it("未跟踪文件暂存后只提交该文件", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await commitAll("init");
    await writeFile(join(repo, "fresh.txt"), "new\n");
    await stageFiles(repo, ["fresh.txt"]);

    const result = await commitChanges(repo, "feat: add fresh", [], { stagedOnly: true });
    expect(result.ok).toBe(true);
    expect(await committedPaths()).toEqual(["fresh.txt"]);
    expect(await porcelain()).toEqual([]);
  });
});

describe("合并冲突文件标记为解决", () => {
  it("冲突态 add 后变为已暂存（冲突分组清空）", async () => {
    await writeFile(join(repo, "conflict.txt"), "base\n");
    await commitAll("base");
    await git(repo, ["checkout", "-q", "-b", "feature"]);
    await writeFile(join(repo, "conflict.txt"), "feature\n");
    await commitAll("feature");
    await git(repo, ["checkout", "-q", "main"]);
    await writeFile(join(repo, "conflict.txt"), "main\n");
    await commitAll("main");

    await expect(git(repo, ["merge", "feature"])).rejects.toBeTruthy();
    expect(await entryOf("conflict.txt")).toMatchObject({ x: "U", y: "U" });

    await expect(stageFiles(repo, ["conflict.txt"])).resolves.toEqual({ ok: true });
    expect(await entryOf("conflict.txt")).toMatchObject({ x: "M", y: " " });
  });
});

describe("git:status / git:diff 的暂存侧别", () => {
  it("status 给出 x=暂存区 / y=工作区，diff 按 staged 参数区分两侧", async () => {
    await writeFile(join(repo, "a.txt"), "a1\n");
    await writeFile(join(repo, "b.txt"), "b1\n");
    await commitAll("init");
    await writeFile(join(repo, "a.txt"), "a2\n");
    await writeFile(join(repo, "b.txt"), "b2\n");
    await stageFiles(repo, ["a.txt"]);

    const status = await invoke<{ branch: string; files: { path: string; x: string; y: string }[] }>(
      "git:status",
      repo,
    );
    const files = new Map(status.files.map((file) => [file.path, file]));
    expect(files.get("a.txt")).toMatchObject({ x: "M", y: " " });
    expect(files.get("b.txt")).toMatchObject({ x: " ", y: "M" });

    // 已暂存文件：--cached diff 有内容，工作区 diff 为空
    await expect(invoke<string | null>("git:diff", repo, "a.txt", true)).resolves.toContain("+a2");
    await expect(invoke<string | null>("git:diff", repo, "a.txt", false)).resolves.toBe("");

    // 工作区文件：工作区 diff 有内容，--cached diff 为空
    await expect(invoke<string | null>("git:diff", repo, "b.txt", false)).resolves.toContain("+b2");
    await expect(invoke<string | null>("git:diff", repo, "b.txt", true)).resolves.toBe("");
  });
});
