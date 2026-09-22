import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
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
