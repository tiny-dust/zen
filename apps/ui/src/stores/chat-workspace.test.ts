import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useWorkspaceStore } from "@/stores/workspace";

let pinia: ReturnType<typeof createPinia>;

function stubZen(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: { onEvent: vi.fn(() => () => undefined) },
    session: {
      create: vi.fn().mockResolvedValue({
        id: "session-1",
        title: "新会话",
        workspaceId: null,
        draft: "",
        pinned: false,
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      }),
      setWorkspace: vi.fn().mockResolvedValue(undefined),
      setDraft: vi.fn(),
      rename: vi.fn(),
    },
    workspace: {
      list: vi.fn().mockResolvedValue([
        {
          id: "common",
          name: "公共区",
          kind: "common",
          path: null,
          archived: false,
          sessions: [],
        },
        {
          id: "ws-a",
          name: "项目 A",
          kind: "workspace",
          path: "/tmp/project-a",
          archived: false,
          sessions: [],
        },
      ]),
    },
    git: {
      info: vi.fn().mockResolvedValue({ repo: "", branch: "" }),
      status: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  stubZen();
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("session workspace selection", () => {
  it("信息卡 Git 版本跟随选中的仓库，并忽略切换前的慢响应", async () => {
    const chat = useChatStore();
    const gitStore = useGitStore();
    const cwd = vi.spyOn(gitStore, "cwd").mockReturnValue("/tmp/project-a/nested");
    let release: ((value: { repo: string; branch: string }) => void) | undefined;
    const info = vi.fn(() => new Promise<{ repo: string; branch: string }>((resolve) => {
      release = resolve;
    }));
    Object.assign(window.zen!.git, { info });

    const first = chat.refreshGit();
    expect(info).toHaveBeenCalledWith("/tmp/project-a/nested");
    cwd.mockReturnValue("/tmp/project-a/other");
    release?.({ repo: "nested", branch: "old" });
    await first;
    expect(chat.branch).toBe("");

    vi.mocked(info).mockResolvedValueOnce({ repo: "other", branch: "main" });
    await chat.refreshGit();
    expect(info).toHaveBeenLastCalledWith("/tmp/project-a/other");
    expect(chat.branch).toBe("main");
  });

  it("切换会话先等待目标工作树，成功后才切可见会话与浏览器 scope", async () => {
    const chat = useChatStore();
    const previousId = chat.sessionId;
    const target = {
      id: "session-worktree", title: "工作树会话", workspaceId: "ws-a", draft: "",
      pinned: false, archived: false, createdAt: 1, updatedAt: 1,
    };
    let release: ((value: null) => void) | undefined;
    const worktree = vi.fn(() => new Promise<null>((resolve) => { release = resolve; }));
    const setScope = vi.fn();
    Object.assign(window.zen!.session, {
      snapshot: vi.fn().mockResolvedValue({ session: target, messages: [] }),
      worktree,
    });
    Object.assign(window.zen!, { browser: { setScope } });

    const switching = chat.loadSession(target);
    await vi.waitFor(() => expect(worktree).toHaveBeenCalledWith(target.id));
    expect(chat.sessionId).toBe(previousId);
    expect(setScope).not.toHaveBeenCalled();

    release?.(null);
    await switching;
    expect(chat.sessionId).toBe(target.id);
    expect(setScope).toHaveBeenCalledWith(target.workspaceId);
  });

  it("目标工作树读取失败时保持原会话和浏览器 scope", async () => {
    const chat = useChatStore();
    const previousId = chat.sessionId;
    const target = {
      id: "session-worktree", title: "工作树会话", workspaceId: "ws-a", draft: "",
      pinned: false, archived: false, createdAt: 1, updatedAt: 1,
    };
    const setScope = vi.fn();
    Object.assign(window.zen!.session, {
      snapshot: vi.fn().mockResolvedValue({ session: target, messages: [] }),
      worktree: vi.fn().mockRejectedValue(new Error("工作树读取失败")),
    });
    Object.assign(window.zen!, { browser: { setScope } });

    await chat.loadSession(target);
    expect(chat.sessionId).toBe(previousId);
    expect(chat.lastError).toContain("工作树读取失败");
    expect(setScope).not.toHaveBeenCalled();
  });

  it("defaults new session workspace to common when no prior active workspace", () => {
    const chat = useChatStore();
    expect(chat.sessionWorkspaceId).toBe("common");
  });

  it("inherits last active workspace as the bottom picker selection", () => {
    localStorage.setItem("zen.activeWorkspace", "ws-a");
    disposePinia(pinia);
    pinia = createPinia();
    setActivePinia(pinia);

    const chat = useChatStore();
    expect(chat.sessionWorkspaceId).toBe("ws-a");
  });

  it("setSessionWorkspace updates sessionWorkspaceId and sidebar active id", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();

    await chat.setSessionWorkspace("ws-a");

    expect(chat.sessionWorkspaceId).toBe("ws-a");
    expect(workspace.activeId).toBe("ws-a");
    expect(workspace.pathOf(chat.sessionWorkspaceId)).toBe("/tmp/project-a");
  });

  it("setSessionWorkspace to common clears agent path to undefined", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("ws-a");

    await chat.setSessionWorkspace("common");

    expect(chat.sessionWorkspaceId).toBe("common");
    expect(workspace.pathOf(chat.sessionWorkspaceId)).toBeUndefined();
  });

  it("后端拒绝绑定工作树会话切换项目时，前台选择保持原工作区", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.newTask("ws-a");
    vi.mocked(window.zen!.session.setWorkspace).mockRejectedValueOnce(new Error("工作树已绑定"));

    await expect(chat.setSessionWorkspace("common")).rejects.toThrow("工作树已绑定");
    expect(chat.sessionWorkspaceId).toBe("ws-a");
    expect(workspace.activeId).toBe("ws-a");
  });

  it("newTask without arg lands in the currently selected workspace", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("ws-a");

    await chat.newTask();

    expect(chat.sessionWorkspaceId).toBe("ws-a");
    expect(workspace.activeId).toBe("ws-a");
  });

  it("newTask without arg can land in common when that is the selection", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("common");

    await chat.newTask();

    expect(chat.sessionWorkspaceId).toBe("common");
  });

  it("newTask with explicit workspaceId overrides the bottom selection", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("common");

    await chat.newTask("ws-a");

    expect(chat.sessionWorkspaceId).toBe("ws-a");
    expect(workspace.activeId).toBe("ws-a");
  });
});
