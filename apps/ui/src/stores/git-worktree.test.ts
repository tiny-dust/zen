import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const worktreePath = vi.hoisted(() => ({ ref: null as unknown as { value: string } }));

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({
    sessionId: "s1",
    sessionWorkspaceId: "ws-1",
    effectiveSelection: { providerId: null, modelId: null },
    refreshGit: () => undefined,
  }),
}));
vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => ({ pathOf: () => "/project" }),
}));
vi.mock("@/stores/session-worktree", () => ({
  useSessionWorktreeStore: () => ({
    cwd: (id: string, localPath: string | undefined) =>
      id === "s1" && worktreePath.ref.value ? worktreePath.ref.value : localPath,
  }),
}));
vi.mock("@/stores/right-panel", () => ({
  useRightPanelStore: () => ({ ensureTab: vi.fn() }),
}));

worktreePath.ref = ref("");

import { useGitStore } from "./git";

const discover = vi.fn();

function stubZen() {
  vi.stubGlobal("zen", {
    git: {
      discover,
      status: vi.fn(async () => ({ branch: "main", files: [] })),
      branches: vi.fn(async () => ({ local: [], remote: [] })),
      log: vi.fn(async () => []),
      stashList: vi.fn(async () => []),
      pr: vi.fn(async () => null),
    },
  });
}

describe("git store 会话工作树", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    discover.mockReset();
    worktreePath.ref.value = "";
    stubZen();
  });

  it("有工作树时在 worktree 路径下发现仓库，切换后重新扫描", async () => {
    discover.mockImplementation(async (root: string) => [{
      path: root,
      relativePath: ".",
      name: "repo",
    }]);
    const store = useGitStore();
    await store.refreshRepositories();
    expect(discover).toHaveBeenLastCalledWith("/project");

    worktreePath.ref.value = "/worktrees/s1";
    await store.refreshRepositories();
    expect(discover).toHaveBeenLastCalledWith("/worktrees/s1");
    expect(store.repositories.map((repo) => repo.path)).toEqual(["/worktrees/s1"]);
  });
});
