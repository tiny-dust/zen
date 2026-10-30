import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRepository, GitStatus } from "@zen/shared";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";
import { useGitStore } from "./git";

const rootRepo: GitRepository = { path: "/project", relativePath: ".", name: "project" };
const nestedRepo: GitRepository = { path: "/project/packages/ui", relativePath: "packages/ui", name: "ui" };

function gitStatus(branch: string): GitStatus {
  return { branch, files: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function gitApi() {
  return {
    discover: vi.fn(async () => [rootRepo, nestedRepo]),
    info: vi.fn(async (path: string) => ({ repo: path, branch: path === rootRepo.path ? "main" : "feature/ui" })),
    status: vi.fn(async (path: string) => gitStatus(path === rootRepo.path ? "main" : "feature/ui")),
    branches: vi.fn(async () => ({ local: [], remote: [] })),
    pr: vi.fn(async () => null),
    log: vi.fn(async () => []),
    stashList: vi.fn(async () => []),
    checkout: vi.fn(async () => ({ ok: true })),
  };
}

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  const workspaces = useWorkspaceStore();
  workspaces.groups = [{
    id: "project",
    name: "Project",
    path: "/project",
    kind: "workspace",
    pinned: false,
    archived: false,
    createdAt: 1,
    sessions: [],
  }];
  const chat = useChatStore();
  chat.sessionId = "session-a";
  chat.sessionWorkspaceId = "project";
});

afterEach(() => {
  vi.unstubAllGlobals();
  disposePinia(pinia);
});

describe("多个 Git 仓库的会话级选择", () => {
  it("发现根仓库与子仓库，默认展示根仓库，切换后读取都指向所选仓库", async () => {
    const git = gitApi();
    vi.stubGlobal("zen", { git });
    const store = useGitStore();
    await store.refreshRepositories();
    await vi.waitFor(() => expect(store.repositoryBranches[nestedRepo.path]).toBe("feature/ui"));

    expect(store.repositories).toEqual([rootRepo, nestedRepo]);
    expect(store.cwd()).toBe(rootRepo.path);
    expect(store.branch).toBe("main");

    await store.selectRepository(nestedRepo.path);
    expect(store.cwd()).toBe(nestedRepo.path);
    expect(store.branch).toBe("feature/ui");
    expect(git.status).toHaveBeenCalledWith(nestedRepo.path);
    expect(git.branches).toHaveBeenCalledWith(nestedRepo.path);
    expect(git.log).toHaveBeenCalledWith(nestedRepo.path, undefined);
    expect(git.stashList).toHaveBeenCalledWith(nestedRepo.path);
    await store.checkout("feature/next");
    expect(git.checkout).toHaveBeenCalledWith(nestedRepo.path, "feature/next");
  });

  it("快速切换仓库和会话时，旧请求不会覆写当前仓库或错误地复用选择", async () => {
    const git = gitApi();
    const oldStatus = deferred<GitStatus>();
    git.status.mockImplementation((path: string) =>
      path === rootRepo.path ? oldStatus.promise : Promise.resolve(gitStatus("feature/ui")));
    vi.stubGlobal("zen", { git });
    const store = useGitStore();
    await store.refreshRepositories();
    await store.selectRepository(nestedRepo.path);
    oldStatus.resolve(gitStatus("stale-main"));
    await nextTick();
    expect(store.branch).toBe("feature/ui");

    const chat = useChatStore();
    chat.sessionId = "session-b";
    await nextTick();
    await store.refreshRepositories();
    expect(store.cwd()).toBe(rootRepo.path);

    chat.sessionId = "session-a";
    await nextTick();
    await store.refreshRepositories();
    expect(store.cwd()).toBe(nestedRepo.path);
  });

  it("切走会话后，旧会话仓库的迟到状态不会写入新会话", async () => {
    const git = gitApi();
    const delayedNested = deferred<GitStatus>();
    git.status.mockImplementation((path: string) =>
      path === nestedRepo.path ? delayedNested.promise : Promise.resolve(gitStatus("main")));
    vi.stubGlobal("zen", { git });
    const store = useGitStore();
    await store.refreshRepositories();
    await vi.waitFor(() => expect(store.branch).toBe("main"));

    const switching = store.selectRepository(nestedRepo.path);
    await vi.waitFor(() => expect(git.status).toHaveBeenCalledWith(nestedRepo.path));
    const chat = useChatStore();
    chat.sessionId = "session-b";
    await nextTick();
    await store.refreshRepositories();
    await vi.waitFor(() => expect(store.branch).toBe("main"));

    delayedNested.resolve(gitStatus("stale-feature"));
    await switching;
    expect(store.cwd()).toBe(rootRepo.path);
    expect(store.branch).toBe("main");
  });

  it("父仓库忽略独立子仓库的改动条目，空文件集不能提交全部", async () => {
    const git = gitApi();
    git.status.mockImplementation(async (path: string) => path === rootRepo.path
      ? {
          branch: "main",
          files: [
            { path: "packages/ui/", x: "?", y: "?", add: 0, del: 0, untracked: true },
            { path: "README.md", x: " ", y: "M", add: 1, del: 0, untracked: false },
          ],
        }
      : gitStatus("feature/ui"));
    vi.stubGlobal("zen", { git });
    const store = useGitStore();
    await store.refreshRepositories();
    await store.refreshStatus();
    expect(store.files.map((file) => file.path)).toEqual(["README.md"]);

    const result = await store.commit("test", []);
    expect(result.ok).toBe(false);
    expect(store.files.map((file) => file.path)).toEqual(["README.md"]);
  });
});
