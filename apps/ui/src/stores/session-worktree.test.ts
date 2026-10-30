import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionWorktree } from "@zen/shared";
import { useSessionWorktreeStore } from "./session-worktree";

function worktree(sessionId: string): SessionWorktree {
  return {
    sessionId,
    projectPath: `/projects/${sessionId}`,
    repoPath: `/projects/${sessionId}`,
    worktreePath: `/worktrees/${sessionId}`,
    path: `/worktrees/${sessionId}`,
    branch: `zen/${sessionId}`,
    createdAt: 1,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.unstubAllGlobals();
});

describe("会话工作树目录", () => {
  it("按会话隔离工作目录，创建和移除不会改变其他会话", async () => {
    const session = {
      worktree: vi.fn(async () => null),
      createWorktree: vi.fn(async (id: string) => ({ ok: true, worktree: worktree(id) })),
      removeWorktree: vi.fn(async () => ({ ok: true })),
    };
    vi.stubGlobal("zen", { session });
    const store = useSessionWorktreeStore();

    await store.create("a");
    expect(store.cwd("a", "/projects/a")).toBe("/worktrees/a");
    expect(store.cwd("b", "/projects/b")).toBe("/projects/b");

    await store.remove("a");
    expect(store.cwd("a", "/projects/a")).toBe("/projects/a");
    expect(store.cwd("b", "/projects/b")).toBe("/projects/b");
  });

  it("加载某会话的绑定只更新该会话", async () => {
    vi.stubGlobal("zen", {
      session: { worktree: vi.fn(async (id: string) => id === "a" ? worktree(id) : null) },
    });
    const store = useSessionWorktreeStore();

    await Promise.all([store.load("a"), store.load("b")]);
    expect(store.cwd("a", "/projects/a")).toBe("/worktrees/a");
    expect(store.cwd("b", "/projects/b")).toBe("/projects/b");
  });
});
