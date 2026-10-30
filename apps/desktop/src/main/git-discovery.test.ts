import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverGitRepositories } from "./git-discovery";
import { git } from "./git-exec";

let tempRoot: string;

async function initRepo(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await git(directory, ["init"]);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "zen-git-discover-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("Git 仓库发现", () => {
  it("发现目录内多个独立仓库，跳过依赖和普通子目录", async () => {
    const root = join(tempRoot, "workspace");
    const first = join(root, "frontend");
    const second = join(root, "packages", "backend");
    await initRepo(first);
    await initRepo(second);
    await mkdir(join(first, "src"));
    await initRepo(join(root, "node_modules", "ignored"));

    const repositories = await discoverGitRepositories(root);
    const firstReal = await realpath(first);
    const secondReal = await realpath(second);
    expect(repositories.map((item) => item.path).sort()).toEqual(
      [firstReal, secondReal].sort(),
    );
    expect(repositories.find((item) => item.path === secondReal)?.relativePath).toBe(
      relative(root, second),
    );
  });

  it("仓库根与嵌套仓库各列一次，扫描子目录仍保留所属父仓库", async () => {
    const root = join(tempRoot, "parent");
    const nested = join(root, "modules", "child");
    await initRepo(root);
    await initRepo(nested);
    const plain = join(root, "plain");
    await mkdir(plain);

    const repositories = await discoverGitRepositories(root);
    const rootReal = await realpath(root);
    const nestedReal = await realpath(nested);
    expect(repositories.map((item) => item.path).sort()).toEqual(
      [rootReal, nestedReal].sort(),
    );
    expect(repositories.find((item) => item.path === rootReal)?.relativePath).toBe(".");
    expect((await discoverGitRepositories(plain)).map((item) => item.path)).toEqual([rootReal]);
  });

  it("识别 .git 文件形式的 worktree，不跟随目录符号链接", async () => {
    const source = join(tempRoot, "source");
    const root = join(tempRoot, "workspace");
    const worktree = join(root, "feature");
    await initRepo(source);
    await git(source, [
      "-c", "user.name=Zen Test", "-c", "user.email=zen@example.invalid",
      "commit", "--allow-empty", "-m", "initial",
    ]);
    await mkdir(root);
    await git(source, ["worktree", "add", "-b", "feature", worktree, "HEAD"]);
    expect((await stat(join(worktree, ".git"))).isFile()).toBe(true);

    if (process.platform !== "win32") {
      await symlink(source, join(root, "linked-source"), "dir");
    }
    expect((await discoverGitRepositories(root)).map((item) => item.path)).toEqual([await realpath(worktree)]);
  });
});
