import { describe, expect, it } from "vitest";

import { groupActivityAt, sortGroupsByActivity, sortSessionsByActivity } from "./workspace-order";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

function session(id: string, updatedAt: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    title: id,
    workspaceId: "w1",
    draft: "",
    pinned: false,
    archived: false,
    createdAt: updatedAt,
    updatedAt,
    ...patch,
  };
}

function group(
  id: string,
  pinned: boolean,
  createdAt: number,
  sessions: SessionRecord[],
): WorkspaceGroup {
  return {
    id,
    name: id,
    path: `/projects/${id}`,
    kind: "workspace",
    pinned,
    archived: false,
    createdAt,
    sessions,
  };
}

describe("侧栏排序", () => {
  it("组内：置顶优先，其余按最近更新时间倒序", () => {
    const list = sortSessionsByActivity([
      session("old", 100),
      session("pinned-old", 10, { pinned: true }),
      session("new", 200),
    ]);
    expect(list.map((item) => item.id)).toEqual(["pinned-old", "new", "old"]);
  });

  it("外层：最近有对话的工作目录浮到顶部", () => {
    const groups = sortGroupsByActivity([
      group("a", false, 1, [session("a-1", 100)]),
      group("b", false, 2, [session("b-1", 300), session("b-2", 250)]),
      group("c", false, 3, []),
    ]);
    expect(groups.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("外层：置顶分组恒在最前，忽略活动时间", () => {
    const groups = sortGroupsByActivity([
      group("hot", false, 1, [session("hot-1", 999)]),
      group("pinned", true, 1, [session("pinned-1", 1)]),
    ]);
    expect(groups.map((item) => item.id)).toEqual(["pinned", "hot"]);
  });

  it("空分组用创建时间兜底，活动时间取未归档会话", () => {
    const empty = group("empty", false, 42, []);
    expect(groupActivityAt(empty)).toBe(42);
    const archivedOnly = group("arch", false, 5, [session("x", 900, { archived: true })]);
    expect(groupActivityAt(archivedOnly)).toBe(5);
  });
});
