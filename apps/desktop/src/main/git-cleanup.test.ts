import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { cleanupBranches } from "./git-cleanup";

function failure(message: string): Error & { stderr: string } {
  return Object.assign(new Error(message), { stderr: message });
}

function mockGit(handler: (args: string[]) => string | Error): string[][] {
  const calls: string[][] = [];
  execFileMock.mockImplementation((cmd: string, args: string[], _options: unknown, cb: (err: Error | null, output?: { stdout: string; stderr: string }) => void) => {
    expect(cmd).toBe("git");
    calls.push(args);
    const result = handler(args);
    if (result instanceof Error) cb(result);
    else cb(null, { stdout: result, stderr: "" });
  });
  return calls;
}

const branchFormat = "--format=%(refname:short)%09%(HEAD)%09%(upstream:track)";
const branches = "main\t*\t\nmerged\t\t[gone]\nactive\t\t\nworktree\t\t[gone]\nfailed\t\t\n";

function mockRepository(overrides: { remotes?: string; fetchError?: Error; deleteError?: Error; statusError?: Error } = {}): string[][] {
  return mockGit((args) => {
    if (args[0] === "remote") return overrides.remotes ?? "origin\nbackup\n";
    if (args[0] === "fetch") return overrides.fetchError ?? "";
    if (args[0] === "for-each-ref" && args.includes(branchFormat)) return branches;
    if (args[0] === "worktree") return overrides.statusError ?? "worktree /repo\nbranch refs/heads/main\n\nworktree /other\nbranch refs/heads/worktree\n";
    if (args[0] === "for-each-ref" && args.includes("--merged=HEAD")) return "main\nmerged\nworktree\nfailed\n";
    if (args[0] === "branch") return args.at(-1) === "failed" ? (overrides.deleteError ?? "") : "";
    throw new Error(`unexpected git command: ${args.join(" ")}`);
  });
}

afterEach(() => vi.clearAllMocks());

describe("cleanupBranches", () => {
  it("未明确确认时不调用 git", async () => {
    await expect(cleanupBranches("/repo", false)).resolves.toEqual({
      ok: false, deleted: [], skipped: [], error: "删除分支前需要用户确认",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("先 fetch 全部远端并 prune，再只用 -d 删除已合并分支，报告 current/worktree/unmerged/gone", async () => {
    const calls = mockRepository({ deleteError: failure("cannot delete branch") });
    const result = await cleanupBranches("/repo", true);
    expect(result).toEqual({
      ok: true,
      deleted: [{ name: "merged", upstreamGone: true }],
      skipped: [
        { name: "main", upstreamGone: false, reason: "current" },
        { name: "active", upstreamGone: false, reason: "unmerged" },
        { name: "worktree", upstreamGone: true, reason: "worktree" },
        { name: "failed", upstreamGone: false, reason: "delete-failed", error: "cannot delete branch" },
      ],
    });
    expect(calls[0]).toEqual(["remote"]);
    expect(calls[1]).toEqual(["fetch", "--all", "--prune"]);
    expect(calls.filter(([command]) => command === "branch")).toEqual([
      ["branch", "-d", "--", "merged"],
      ["branch", "-d", "--", "failed"],
    ]);
  });

  it("无远端时跳过所有分支，不 fetch 也不删除", async () => {
    const calls = mockRepository({ remotes: "" });
    const result = await cleanupBranches("/repo", true);
    expect(result.ok).toBe(false);
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped.every((item) => item.reason === "no-remote")).toBe(true);
    expect(calls.map(([cmd]) => cmd)).toEqual(["remote", "for-each-ref"]);
  });

  it("任一远端 fetch 失败时不删除，报告网络错误与跳过列表", async () => {
    const calls = mockRepository({ fetchError: failure("network unavailable") });
    const result = await cleanupBranches("/repo", true);
    expect(result).toMatchObject({ ok: false, deleted: [], error: "network unavailable" });
    expect(result.skipped.every((item) => item.reason === "fetch-failed")).toBe(true);
    expect(calls.map(([cmd]) => cmd)).toEqual(["remote", "fetch", "for-each-ref"]);
  });

  it("无法确认 worktree 状态时停止，不删除任何分支", async () => {
    const calls = mockRepository({ statusError: failure("worktree list failed") });
    const result = await cleanupBranches("/repo", true);
    expect(result).toMatchObject({ ok: false, deleted: [], error: "worktree list failed" });
    expect(calls.some(([cmd]) => cmd === "branch")).toBe(false);
  });
});
