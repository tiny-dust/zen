import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import {
  abortMerge,
  countAheadBehind,
  describeGitError,
  fetchRemote,
  isSafeRefName,
  mergeBranch,
  pullRemote,
  stashApply,
  stashDrop,
  stashList,
  stashPush,
  discardChanges,
} from "./git-remote";

type GitResult = { stdout?: string; stderr?: string } | (Error & { stderr?: string });

/** 按 git 子命令分发的 execFile 替身（promisify 后回调第二个参数即 resolve 值）；
 *  "-c core.quotepath=false diff …" 这类全局配置前缀取实际子命令分发 */
function mockGit(handlers: Record<string, (args: string[]) => GitResult>): void {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      callback: (err: unknown, value?: { stdout: string; stderr: string }) => void,
    ) => {
      const sub = args[0] === "-c" ? (args[2] ?? "") : (args[0] ?? "");
      const handler = handlers[sub];
      if (!handler) {
        throw new Error(`测试未预期的 git 子命令：${args.join(" ")}`);
      }
      const result = handler(args);
      if (result instanceof Error) {
        callback(result);
        return;
      }
      callback(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
    },
  );
}

function gitFailure(stderr: string): Error & { stderr: string } {
  const error = new Error("git 命令失败") as Error & { stderr: string };
  error.stderr = stderr;
  return error;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("isSafeRefName", () => {
  it("允许常规本地/远程分支名（含 . _ - /）", () => {
    expect(isSafeRefName("main")).toBe(true);
    expect(isSafeRefName("feature/login-fix")).toBe(true);
    expect(isSafeRefName("origin/main")).toBe(true);
    expect(isSafeRefName("release_1.2.3")).toBe(true);
  });

  it("拒绝空串、旗标注入与 git 特殊字符", () => {
    expect(isSafeRefName("")).toBe(false);
    expect(isSafeRefName("  ")).toBe(false);
    expect(isSafeRefName("-b")).toBe(false);
    expect(isSafeRefName("--force")).toBe(false);
    expect(isSafeRefName("a b")).toBe(false);
    expect(isSafeRefName("a~b")).toBe(false);
    expect(isSafeRefName("a^b")).toBe(false);
    expect(isSafeRefName("a:b")).toBe(false);
    expect(isSafeRefName("a?b")).toBe(false);
    expect(isSafeRefName("a*b")).toBe(false);
    expect(isSafeRefName("a[b")).toBe(false);
    expect(isSafeRefName("a\\b")).toBe(false);
  });
});

describe("describeGitError", () => {
  it("stderr 优先（trim 后），回退 message，再回退默认文案", () => {
    expect(describeGitError(gitFailure("  rejected: non-fast-forward \n"), "推送失败")).toBe(
      "rejected: non-fast-forward",
    );
    expect(describeGitError(new Error("网络不可用"), "拉取失败")).toBe("网络不可用");
    expect(describeGitError({}, "兜底文案")).toBe("兜底文案");
  });
});

describe("countAheadBehind", () => {
  it("左=落后 右=领先，按 \\t 拆分", async () => {
    mockGit({ "rev-list": () => ({ stdout: "2\t5\n" }) });
    await expect(countAheadBehind("/repo")).resolves.toEqual({ ahead: 5, behind: 2 });
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("无上游（命令失败）返回空对象", async () => {
    mockGit({ "rev-list": () => gitFailure("no upstream") });
    await expect(countAheadBehind("/repo")).resolves.toEqual({});
  });
});

describe("fetchRemote", () => {
  it("fetch 后返回当前分支 ahead/behind", async () => {
    const calls: string[][] = [];
    mockGit({
      fetch: (args) => {
        calls.push(args);
        return {};
      },
      "rev-list": (args) => {
        calls.push(args);
        return { stdout: "3\t1\n" };
      },
    });
    await expect(fetchRemote("/repo")).resolves.toEqual({ ok: true, ahead: 1, behind: 3 });
    expect(calls).toEqual([["fetch"], ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]]);
  });

  it("无上游时成功但省略计数", async () => {
    mockGit({
      fetch: () => ({}),
      "rev-list": () => gitFailure("no upstream"),
    });
    await expect(fetchRemote("/repo")).resolves.toEqual({ ok: true });
  });

  it("fetch 失败透传 stderr", async () => {
    mockGit({ fetch: () => gitFailure("fatal: could not read from remote repository") });
    await expect(fetchRemote("/repo")).resolves.toEqual({
      ok: false,
      error: "fatal: could not read from remote repository",
    });
  });
});

describe("pullRemote", () => {
  it("无上游时给清晰报错且不执行 pull", async () => {
    mockGit({ "rev-parse": () => gitFailure("no upstream configured for branch 'main'") });
    await expect(pullRemote("/repo")).resolves.toEqual({
      ok: false,
      error: "当前分支没有上游分支，请先推送以建立追踪关系",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("默认策略拉取（--no-edit）并返回输出与计数", async () => {
    const calls: string[][] = [];
    mockGit({
      "rev-parse": (args) => {
        calls.push(args);
        return { stdout: "origin/main\n" };
      },
      pull: (args) => {
        calls.push(args);
        return { stdout: "Fast-forward\n src/a.ts | 2 +\n" };
      },
      "rev-list": () => ({ stdout: "0\t0\n" }),
    });
    await expect(pullRemote("/repo")).resolves.toEqual({
      ok: true,
      output: "Fast-forward\n src/a.ts | 2 +",
      ahead: 0,
      behind: 0,
    });
    expect(calls[1]).toEqual(["pull", "--no-edit"]);
  });

  it("冲突时返回冲突文件列表（不自动 commit）", async () => {
    mockGit({
      "rev-parse": () => ({ stdout: "origin/main\n" }),
      pull: () => gitFailure("CONFLICT (content): Merge conflict in src/a.ts"),
      diff: () => ({ stdout: "src/a.ts\nsrc/中文 目录/b.ts\n" }),
    });
    await expect(pullRemote("/repo")).resolves.toEqual({
      ok: false,
      conflicts: ["src/a.ts", "src/中文 目录/b.ts"],
      error: "CONFLICT (content): Merge conflict in src/a.ts",
    });
    expect(execFileMock).toHaveBeenLastCalledWith(
      "git",
      ["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("工作区脏等普通失败：无冲突文件时只透传错误", async () => {
    mockGit({
      "rev-parse": () => ({ stdout: "origin/main\n" }),
      pull: () => gitFailure("error: Your local changes would be overwritten by merge"),
      diff: () => ({ stdout: "" }),
    });
    await expect(pullRemote("/repo")).resolves.toEqual({
      ok: false,
      conflicts: [],
      error: "error: Your local changes would be overwritten by merge",
    });
  });
});

describe("mergeBranch", () => {
  it("分支名不合法时拒绝且不调用 git", async () => {
    await expect(mergeBranch("/repo", "--force")).resolves.toEqual({
      ok: false,
      error: "分支名不合法",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("合并成功：--no-edit + 目标分支，输出透传", async () => {
    mockGit({
      merge: (args) => {
        expect(args).toEqual(["merge", "--no-edit", "origin/main"]);
        return { stdout: "Merge made by the 'ort' strategy.\n" };
      },
    });
    await expect(mergeBranch("/repo", " origin/main ")).resolves.toEqual({
      ok: true,
      output: "Merge made by the 'ort' strategy.",
    });
  });

  it("冲突时返回冲突文件列表", async () => {
    mockGit({
      merge: () => gitFailure("Automatic merge failed; fix conflicts and then commit the result."),
      diff: () => ({ stdout: "src/a.ts\n" }),
    });
    await expect(mergeBranch("/repo", "dev")).resolves.toEqual({
      ok: false,
      conflicts: ["src/a.ts"],
      error: "Automatic merge failed; fix conflicts and then commit the result.",
    });
  });
});

describe("abortMerge", () => {
  it("成功执行 merge --abort", async () => {
    mockGit({ merge: (args) => {
      expect(args).toEqual(["merge", "--abort"]);
      return { stdout: "" };
    } });
    await expect(abortMerge("/repo")).resolves.toEqual({ ok: true, output: "" });
  });

  it("无合并进行中时透传 git 报错", async () => {
    mockGit({ merge: () => gitFailure("fatal: There is no merge to abort") });
    await expect(abortMerge("/repo")).resolves.toEqual({
      ok: false,
      error: "fatal: There is no merge to abort",
    });
  });
});

describe("stashPush", () => {
  it("工作区干净时前置报错，不执行 stash", async () => {
    mockGit({ status: () => ({ stdout: "" }) });
    await expect(stashPush("/repo")).resolves.toEqual({
      ok: false,
      error: "没有可贮藏的变更",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("无消息：stash push -u（含未跟踪文件）", async () => {
    mockGit({
      status: () => ({ stdout: " M a.ts\n" }),
      stash: (args) => {
        expect(args).toEqual(["stash", "push", "-u"]);
        return { stdout: "Saved working directory and index state WIP on main\n" };
      },
    });
    await expect(stashPush("/repo")).resolves.toEqual({
      ok: true,
      output: "Saved working directory and index state WIP on main",
    });
  });

  it("带可选消息：-m 追加", async () => {
    mockGit({
      status: () => ({ stdout: " M a.ts\n" }),
      stash: (args) => {
        expect(args).toEqual(["stash", "push", "-u", "-m", "wip: 登录页"]);
        return { stdout: "" };
      },
    });
    await expect(stashPush("/repo", " wip: 登录页 ")).resolves.toEqual({ ok: true, output: "" });
  });

  it("失败透传 stderr", async () => {
    mockGit({
      status: () => ({ stdout: " M a.ts\n" }),
      stash: () => gitFailure("error: could not write stash"),
    });
    await expect(stashPush("/repo")).resolves.toEqual({
      ok: false,
      error: "error: could not write stash",
    });
  });
});

describe("discardChanges", () => {
  it("单文件：已跟踪 checkout HEAD，未跟踪 clean -f", async () => {
    mockGit({
      status: () => ({ stdout: " M a.ts\n?? new.ts\n" }),
      checkout: (args) => {
        expect(args).toEqual(["checkout", "HEAD", "--", "a.ts"]);
        return { stdout: "" };
      },
      clean: (args) => {
        expect(args).toEqual(["clean", "-f", "--", "new.ts"]);
        return { stdout: "Removing new.ts\n" };
      },
    });
    await expect(discardChanges("/repo", ["a.ts", "new.ts"])).resolves.toEqual({ ok: true });
  });

  it("全部撤回：reset --hard HEAD + clean -fd（不带 -x，忽略项保留）", async () => {
    const calls: string[][] = [];
    mockGit({
      reset: (args) => {
        calls.push(args);
        return { stdout: "HEAD is now at abc1234\n" };
      },
      clean: (args) => {
        calls.push(args);
        return { stdout: "" };
      },
    });
    await expect(discardChanges("/repo")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["reset", "--hard", "HEAD"], ["clean", "-fd"]]);
  });

  it("git 报错时返回 stderr 文案", async () => {
    mockGit({
      reset: () => gitFailure("error: reset failed"),
    });
    await expect(discardChanges("/repo")).resolves.toEqual({
      ok: false,
      error: "error: reset failed",
    });
  });
});

describe("stashApply", () => {
  it("序号不合法（负数/小数）时拒绝且不调用 git", async () => {
    await expect(stashApply("/repo", -1, "apply")).resolves.toEqual({
      ok: false,
      error: "贮藏序号不合法",
    });
    await expect(stashApply("/repo", 1.5, "pop")).resolves.toEqual({
      ok: false,
      error: "贮藏序号不合法",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("apply 保留条目：stash apply stash@{n}", async () => {
    mockGit({ stash: (args) => {
      expect(args).toEqual(["stash", "apply", "stash@{2}"]);
      return { stdout: "On branch main\n" };
    } });
    await expect(stashApply("/repo", 2, "apply")).resolves.toEqual({ ok: true, output: "On branch main" });
  });

  it("pop 应用成功后删除：stash pop stash@{0}", async () => {
    mockGit({ stash: (args) => {
      expect(args).toEqual(["stash", "pop", "stash@{0}"]);
      return { stdout: "" };
    } });
    await expect(stashApply("/repo", 0, "pop")).resolves.toEqual({ ok: true, output: "" });
  });

  it("应用冲突时返回冲突文件列表", async () => {
    mockGit({
      stash: () => gitFailure("CONFLICT (content): Merge conflict in b.ts"),
      diff: () => ({ stdout: "b.ts\n" }),
    });
    await expect(stashApply("/repo", 0, "apply")).resolves.toEqual({
      ok: false,
      conflicts: ["b.ts"],
      error: "CONFLICT (content): Merge conflict in b.ts",
    });
  });
});

describe("stashDrop", () => {
  it("stash drop stash@{n}", async () => {
    mockGit({ stash: (args) => {
      expect(args).toEqual(["stash", "drop", "stash@{1}"]);
      return { stdout: "Dropped refs/stash@{1}\n" };
    } });
    await expect(stashDrop("/repo", 1)).resolves.toEqual({
      ok: true,
      output: "Dropped refs/stash@{1}",
    });
  });

  it("序号不合法时拒绝且不调用 git", async () => {
    await expect(stashDrop("/repo", -3)).resolves.toEqual({
      ok: false,
      error: "贮藏序号不合法",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("stashList", () => {
  it("解析 %gd/%h/%s 三列，含中文与空格", async () => {
    mockGit({
      stash: () => ({
        stdout: "stash@{0}\tabc1234\tWIP on main: 9f2c1ad 修复登录\nstash@{1}\tdef5678\tOn dev: 自定义说明\n",
      }),
    });
    await expect(stashList("/repo")).resolves.toEqual([
      { index: 0, hash: "abc1234", message: "WIP on main: 9f2c1ad 修复登录" },
      { index: 1, hash: "def5678", message: "On dev: 自定义说明" },
    ]);
  });

  it("消息含 \\t 时按原样拼回，%gd 解析失败按行序兜底", async () => {
    mockGit({
      stash: () => ({ stdout: "stash@{0}\tabc\t带\t制表符的说明\ngarbage\txyz\t第二条\n" }),
    });
    await expect(stashList("/repo")).resolves.toEqual([
      { index: 0, hash: "abc", message: "带\t制表符的说明" },
      { index: 1, hash: "xyz", message: "第二条" },
    ]);
  });

  it("无贮藏/命令失败返回空数组", async () => {
    mockGit({ stash: () => ({ stdout: "" }) });
    await expect(stashList("/repo")).resolves.toEqual([]);
    mockGit({ stash: () => gitFailure("not a git repository") });
    await expect(stashList("/repo")).resolves.toEqual([]);
  });
});
