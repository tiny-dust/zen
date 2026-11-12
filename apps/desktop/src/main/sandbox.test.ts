import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { cp, lstat, mkdir, mkdtemp, open, rename, rm, stat, unlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  cp: vi.fn(), lstat: vi.fn(), mkdir: vi.fn(), mkdtemp: vi.fn(), open: vi.fn(), rename: vi.fn(),
  rm: vi.fn(), stat: vi.fn(), unlink: vi.fn(),
}));
vi.mock("./zen-dir", () => ({ zenSandboxRoot: () => "/zen/sandbox" }));

import { resolveWorkspaceDir, sandboxDirFor } from "./sandbox";

const projectPath = "/projects/example";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(stat).mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));
  vi.mocked(lstat).mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));
  vi.mocked(mkdtemp).mockImplementation(async (prefix) => `${prefix}test`);
  vi.mocked(open).mockResolvedValue({ close: vi.fn() } as unknown as FileHandle);
});

describe("resolveWorkspaceDir", () => {
  it("direct 模式直接返回源目录，不访问隔离区", async () => {
    expect(await resolveWorkspaceDir(projectPath, "direct")).toEqual({
      dir: projectPath, isolated: false, reused: false,
    });
    expect(stat).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
  });

  it("isolated 模式复用已有副本，不重新复制", async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats);

    expect(await resolveWorkspaceDir(projectPath, "isolated")).toEqual({
      dir: sandboxDirFor(projectPath), isolated: true, reused: true,
    });
    expect(cp).not.toHaveBeenCalled();
  });

  it("isolated 模式仅在复制成功后发布目录，之后复用已成功副本", async () => {
    const target = sandboxDirFor(projectPath);
    const staging = `${target}.staging-test`;
    let published = false;
    vi.mocked(stat).mockImplementation(async () => {
      if (published) return { isDirectory: () => true } as Stats;
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    });
    vi.mocked(rename).mockImplementation(async () => { published = true; });

    expect(await resolveWorkspaceDir(projectPath, "isolated")).toEqual({
      dir: target, isolated: true, reused: false,
    });
    expect(mkdir).toHaveBeenCalledWith("/zen/sandbox", { recursive: true });
    expect(mkdtemp).toHaveBeenCalledWith(`${target}.staging-`);
    expect(cp).toHaveBeenCalledWith(projectPath, staging, expect.objectContaining({ recursive: true }));
    expect(rename).toHaveBeenCalledWith(staging, target);
    expect(vi.mocked(rename).mock.invocationCallOrder[0] ?? 0)
      .toBeGreaterThan(vi.mocked(cp).mock.invocationCallOrder[0] ?? 0);
    expect(unlink).toHaveBeenCalledWith(`${target}.lock`);

    expect(await resolveWorkspaceDir(projectPath, "isolated")).toEqual({
      dir: target, isolated: true, reused: true,
    });
    expect(cp).toHaveBeenCalledTimes(1);
  });

  it("检查隔离区失败时拒绝复制及回退源目录", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.mocked(stat).mockRejectedValue(error);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toBe(error);
    expect(cp).not.toHaveBeenCalled();
  });

  it("隔离区路径是文件时拒绝使用", async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as Stats);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toThrow("隔离区路径已存在且不是目录");
    expect(cp).not.toHaveBeenCalled();
  });

  it.each([
    ["创建隔离目录", mkdir],
    ["复制项目", cp],
  ])("%s失败时拒绝回退源目录", async (_step, operation) => {
    const error = new Error("permission denied");
    vi.mocked(operation).mockRejectedValueOnce(error);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toMatchObject({
      message: "复制项目到隔离区失败", cause: error,
    });
    expect(rename).not.toHaveBeenCalled();
  });

  it("复制中途失败留下的 staging 不会在下一次当作副本复用", async () => {
    const target = sandboxDirFor(projectPath);
    const failure = new Error("copy interrupted");
    let sequence = 0;
    vi.mocked(mkdtemp).mockImplementation(async (prefix) => `${prefix}${++sequence}`);
    vi.mocked(cp).mockRejectedValueOnce(failure);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toMatchObject({
      message: "复制项目到隔离区失败", cause: failure,
    });
    expect(rename).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledWith(`${target}.lock`);

    expect(await resolveWorkspaceDir(projectPath, "isolated")).toEqual({
      dir: target, isolated: true, reused: false,
    });
    expect(cp).toHaveBeenNthCalledWith(2, projectPath, `${target}.staging-2`, expect.anything());
    expect(rename).toHaveBeenCalledWith(`${target}.staging-2`, target);
  });

  it("复制过程中目标被其他执行者创建时拒绝覆盖", async () => {
    const missing = Object.assign(new Error("not found"), { code: "ENOENT" });
    vi.mocked(lstat).mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ isDirectory: () => true } as Stats);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toThrow("复制项目到隔离区失败");
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledWith(`${sandboxDirFor(projectPath)}.lock`);
  });

  it("目标是失效符号链接时不覆盖已有路径", async () => {
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => true } as Stats);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toThrow("复制项目到隔离区失败");
    expect(cp).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("并发初始化已有锁时保守失败，不触碰对方的目录", async () => {
    const locked = Object.assign(new Error("already locked"), { code: "EEXIST" });
    vi.mocked(open).mockRejectedValueOnce(locked);

    await expect(resolveWorkspaceDir(projectPath, "isolated")).rejects.toMatchObject({
      message: "复制项目到隔离区失败", cause: locked,
    });
    expect(cp).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
});
