import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { checkoutBranch, commitAll, isSafeBranchName, listBranches } from "./git-ops";

type GitResult =
  | { stdout?: string; stderr?: string }
  | (Error & { killed?: boolean })
  /** 显式以非 Error 值 reject（覆盖 gitError 的 String(error) 分支） */
  | { reject: unknown };

/** 按 git 子命令分发的 execFile 替身（promisify 后回调第二个参数即 resolve 值） */
function mockGit(handlers: Record<string, (args: string[]) => GitResult>): void {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      callback: (err: unknown, value?: { stdout: string; stderr: string }) => void,
    ) => {
      const handler = handlers[args[0] ?? ""];
      if (!handler) {
        throw new Error(`测试未预期的 git 子命令：${args.join(" ")}`);
      }
      const result = handler(args);
      if (result instanceof Error) {
        callback(result);
        return;
      }
      if ("reject" in result) {
        callback(result.reject);
        return;
      }
      callback(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("分支名白名单", () => {
  it("允许字母数字开头的常规分支名（含 . _ - / ）", () => {
    expect(isSafeBranchName("main")).toBe(true);
    expect(isSafeBranchName("feature/login-fix")).toBe(true);
    expect(isSafeBranchName("release_1.2.3")).toBe(true);
    expect(isSafeBranchName("a".repeat(200))).toBe(true);
  });

  it("拒绝空串、超长、选项注入与非法字符", () => {
    expect(isSafeBranchName("")).toBe(false);
    expect(isSafeBranchName("a".repeat(201))).toBe(false);
    expect(isSafeBranchName("-b")).toBe(false);
    expect(isSafeBranchName("--force")).toBe(false);
    expect(isSafeBranchName(".hidden")).toBe(false);
    expect(isSafeBranchName("a b")).toBe(false);
    expect(isSafeBranchName("a;b")).toBe(false);
    expect(isSafeBranchName("a$(x)")).toBe(false);
    expect(isSafeBranchName("中文")).toBe(false);
  });
});

describe("listBranches", () => {
  it("当前分支单列并保持输出顺序，空行忽略", async () => {
    mockGit({
      branch: () => ({ stdout: "* main\n  dev\n\n  feature/x\n" }),
    });
    await expect(listBranches("/repo")).resolves.toEqual({
      current: "main",
      branches: ["main", "dev", "feature/x"],
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["branch", "--list"],
      expect.objectContaining({ cwd: "/repo", timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it("detached HEAD 原样作为条目返回", async () => {
    mockGit({
      branch: () => ({ stdout: "* (HEAD detached at abc123)\n  main\n" }),
    });
    await expect(listBranches("/repo")).resolves.toEqual({
      current: "(HEAD detached at abc123)",
      branches: ["(HEAD detached at abc123)", "main"],
    });
  });

  it("空仓库无分支输出", async () => {
    mockGit({ branch: () => ({ stdout: "" }) });
    await expect(listBranches("/repo")).resolves.toEqual({ current: "", branches: [] });
  });
});

describe("checkoutBranch", () => {
  it("工作区脏 → 拒绝并标 dirty，错误含截断后的 status", async () => {
    const longStatus = ` M ${"a".repeat(500)}\n`;
    mockGit({ status: () => ({ stdout: longStatus }) });
    const result = await checkoutBranch("/repo", "dev");
    expect(result.ok).toBe(false);
    expect(result.dirty).toBe(true);
    expect(result.error).toContain("工作区有未提交变更");
    // 400 字截断后带省略号
    expect(result.error?.endsWith("…")).toBe(true);
    expect(result.error?.length).toBeLessThan(500);
  });

  it("分支名不合法 → 拒绝且不调用 rev-parse/checkout", async () => {
    mockGit({ status: () => ({ stdout: "" }) });
    const result = await checkoutBranch("/repo", "--force");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("分支名不合法");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("本地分支不存在 → 提示不存在", async () => {
    mockGit({
      status: () => ({ stdout: "" }),
      "rev-parse": () => {
        const error = new Error("not found") as Error & { code?: string };
        error.code = "ENOENT";
        return error;
      },
    });
    await expect(checkoutBranch("/repo", "nope")).resolves.toEqual({
      ok: false,
      error: "本地分支不存在：nope",
    });
  });

  it("工作区干净且分支存在 → checkout 成功", async () => {
    const seen: string[][] = [];
    mockGit({
      status: () => ({ stdout: "" }),
      "rev-parse": (args) => {
        seen.push(args);
        return { stdout: "abc123\n" };
      },
      checkout: (args) => {
        seen.push(args);
        return { stdout: "" };
      },
    });
    await expect(checkoutBranch("/repo", "dev")).resolves.toEqual({ ok: true });
    expect(seen).toEqual([
      ["rev-parse", "--verify", "--quiet", "refs/heads/dev"],
      ["checkout", "dev"],
    ]);
  });

  it("gitError：killed → 超时文案；stderr 优先截断 500 字", async () => {
    const killed = new Error("killed") as Error & { killed?: boolean };
    killed.killed = true;
    mockGit({ status: () => killed });
    await expect(checkoutBranch("/repo", "dev")).resolves.toEqual({
      ok: false,
      error: "git 命令超时（30s）",
    });

    const withStderr = new Error("cmd failed") as Error & { stderr?: string };
    withStderr.stderr = "error: pathspec 'dev' did not match\n".repeat(30);
    mockGit({
      status: () => ({ stdout: "" }),
      "rev-parse": () => ({ stdout: "abc\n" }),
      checkout: () => withStderr,
    });
    const result = await checkoutBranch("/repo", "dev");
    expect(result.error).toContain("error: pathspec");
    expect(result.error?.length).toBeLessThanOrEqual(501);
    expect(result.error?.endsWith("…")).toBe(true);
  });

  it("gitError：无 stderr 时回退 Error.message，非 Error 抛出物转字符串", async () => {
    mockGit({ status: () => new Error("git 不可用") });
    await expect(checkoutBranch("/repo", "dev")).resolves.toEqual({
      ok: false,
      error: "git 不可用",
    });

    mockGit({ status: () => ({ reject: "字符串异常" }) });
    await expect(checkoutBranch("/repo", "dev")).resolves.toEqual({
      ok: false,
      error: "字符串异常",
    });
  });
});

describe("commitAll", () => {
  it("无变更 → clean 提示，不执行 add/commit", async () => {
    mockGit({ status: () => ({ stdout: "" }) });
    await expect(commitAll("/repo", "msg")).resolves.toEqual({
      ok: false,
      clean: true,
      error: "没有可提交的变更",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("add -A + commit（尾注 via Zen/飞书）+ log 摘要", async () => {
    const calls: string[][] = [];
    mockGit({
      status: () => ({ stdout: " M src/a.ts\n" }),
      add: (args) => {
        calls.push(args);
        return {};
      },
      commit: (args) => {
        calls.push(args);
        return {};
      },
      log: (args) => {
        calls.push(args);
        return { stdout: "abc1234 fix bug\n 1 file changed\n" };
      },
    });
    const result = await commitAll("/repo", "修复空指针");
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("abc1234 fix bug");
    expect(calls[1]).toEqual(["commit", "-m", "修复空指针\n\nvia Zen/飞书"]);
    expect(calls[2]).toEqual(["log", "-1", "--oneline", "--shortstat"]);
  });

  it("摘要超 2000 字截断带省略号", async () => {
    mockGit({
      status: () => ({ stdout: " M a\n" }),
      add: () => ({}),
      commit: () => ({}),
      log: () => ({ stdout: "x".repeat(2_500) }),
    });
    const result = await commitAll("/repo", "m");
    expect(result.summary?.length).toBe(2_001);
    expect(result.summary?.endsWith("…")).toBe(true);
  });

  it("commit 失败 → 返回 gitError 文案", async () => {
    const failure = new Error("nothing to commit") as Error & { stderr?: string };
    failure.stderr = "nothing to commit, working tree clean\n";
    mockGit({
      status: () => ({ stdout: " M a\n" }),
      add: () => ({}),
      commit: () => failure,
    });
    await expect(commitAll("/repo", "m")).resolves.toEqual({
      ok: false,
      error: "nothing to commit, working tree clean",
    });
  });
});
