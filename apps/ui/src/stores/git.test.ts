import { describe, expect, it } from "vitest";

import { groupChanges, isConflictChange } from "./git";

import type { GitFileChange } from "@zen/shared";

function change(partial: Partial<GitFileChange> & { path: string }): GitFileChange {
  return { x: " ", y: " ", add: 1, del: 0, untracked: false, ...partial };
}

describe("Git 变更分组（x=暂存区 / y=工作区）", () => {
  it("冲突状态对（U / AA / DD）全部进冲突分组", () => {
    const files = [
      change({ path: "both-modified", x: "U", y: "U" }),
      change({ path: "both-added", x: "A", y: "A" }),
      change({ path: "both-deleted", x: "D", y: "D" }),
      change({ path: "deleted-by-us", x: "U", y: "D" }),
      change({ path: "plain", x: "M", y: " " }),
    ];
    const groups = groupChanges(files);
    expect(groups.conflicts.map((item) => item.path)).toEqual([
      "both-modified",
      "both-added",
      "both-deleted",
      "deleted-by-us",
    ]);
    expect(groups.staged.map((item) => item.path)).toEqual(["plain"]);
    expect(groups.unstaged).toEqual([]);
    expect(isConflictChange(files[0])).toBe(true);
    expect(isConflictChange(files[4])).toBe(false);
  });

  it("已暂存只看 x，更改只看 y 或未跟踪；部分暂存文件同时出现在两组", () => {
    const files = [
      change({ path: "staged-only", x: "M", y: " " }),
      change({ path: "staged-added", x: "A", y: " " }),
      change({ path: "unstaged-only", x: " ", y: "M" }),
      change({ path: "untracked", x: "?", y: "?", untracked: true }),
      change({ path: "partial", x: "M", y: "M" }),
    ];
    const groups = groupChanges(files);
    expect(groups.staged.map((item) => item.path)).toEqual(["staged-only", "staged-added", "partial"]);
    expect(groups.unstaged.map((item) => item.path)).toEqual(["unstaged-only", "untracked", "partial"]);
    expect(groups.conflicts).toEqual([]);
  });

  it("未跟踪文件不会误入已暂存分组（x/y 都是 ?）", () => {
    const groups = groupChanges([change({ path: "new.ts", x: "?", y: "?", untracked: true })]);
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged.map((item) => item.path)).toEqual(["new.ts"]);
  });

  it("分组计数与事件顺序无关，空输入得到三个空组", () => {
    expect(groupChanges([])).toEqual({ conflicts: [], staged: [], unstaged: [] });
    const files = [
      change({ path: "a", x: " ", y: "M" }),
      change({ path: "b", x: "M", y: " " }),
      change({ path: "c", x: "U", y: "U" }),
    ];
    const groups = groupChanges([...files].reverse());
    expect(groups.conflicts).toHaveLength(1);
    expect(groups.staged).toHaveLength(1);
    expect(groups.unstaged).toHaveLength(1);
  });
});
