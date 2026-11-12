// 终端面板按工作区分桶：切换恢复（PTY 不销毁）+ 后台桶内终端退出摘除。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalSessionInfo } from "@zen/shared";

import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useTerminalStore } from "@/stores/terminal";

function termOf(id: string): TerminalSessionInfo {
  return { id, shell: "/bin/zsh", pid: 1000 + Number(id.replace(/\D/g, "") || 0) } as TerminalSessionInfo;
}

type ExitHandler = (event: { sessionId: string; exitCode: number }) => void;
type DataHandler = (event: { sessionId: string; data: string }) => void;

let exitHandlers: ExitHandler[] = [];
let dataHandlers: DataHandler[] = [];

function stubTerminalZen() {
  exitHandlers = [];
  dataHandlers = [];
  vi.stubGlobal("zen", {
    terminal: {
      onData: vi.fn((handler: DataHandler) => {
        dataHandlers.push(handler);
        return () => undefined;
      }),
      onExit: vi.fn((handler: ExitHandler) => {
        exitHandlers.push(handler);
        return () => undefined;
      }),
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  stubTerminalZen();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("terminal bindWorkspaceScope 按工作区分桶", () => {
  it("切换工作区再切回：恢复终端列表 / 活动终端 / 命名 / 分屏", () => {
    const store = useTerminalStore();
    store.bindWorkspaceScope("s1");
    // 直接布置现场（绕过 IPC 创建路径）
    store.sessions = [termOf("t1"), termOf("t2")];
    store.activeId = "t2";
    store.rename("t1", "build");
    store.splitMode = "columns";
    store.paneIds = ["t1", "t2"];

    store.bindWorkspaceScope("s2");
    expect(store.sessions).toHaveLength(0);
    expect(store.activeId).toBe("");
    expect(store.splitMode).toBe("none");

    // 新工作区里另有一组终端
    store.sessions = [termOf("t9")];
    store.activeId = "t9";

    store.bindWorkspaceScope("s1");
    expect(store.sessions.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(store.activeId).toBe("t2");
    expect(store.names["t1"]).toBe("build");
    expect(store.splitMode).toBe("columns");
    expect(store.paneIds).toEqual(["t1", "t2"]);
  });

  it("输出缓冲跨工作区全局共享：切走再切回按 id 回放", () => {
    const store = useTerminalStore();
    store.bindWorkspaceScope("s1");
    store.bindEvents();
    // 模拟主进程 PTY 输出（含后台会话的终端）
    for (const handler of dataHandlers) {
      handler({ sessionId: "t1", data: "hello " });
      handler({ sessionId: "t1", data: "zen" });
    }
    // 缓冲跨工作区全局共享：切走不销毁（后台终端继续写），切回直接按 id 读取
    store.bindWorkspaceScope("s2");
    for (const handler of dataHandlers) {
      handler({ sessionId: "t1", data: "!" });
    }
    store.bindWorkspaceScope("s1");
    expect(store.getBuffer("t1")).toBe("hello zen!");
  });

  it("后台工作区桶里的终端退出：从对应桶摘除，切回后不再出现", () => {
    const store = useTerminalStore();
    store.bindWorkspaceScope("s1");
    store.sessions = [termOf("t1"), termOf("t2")];
    store.activeId = "t1";
    store.paneIds = ["t1"];

    // 切走：t1/t2 进入 s1 桶；当前视图切到 s2（自己的一组终端）
    store.bindWorkspaceScope("s2");
    store.sessions = [termOf("t9")];
    store.activeId = "t9";
    store.paneIds = ["t9"];
    store.bindEvents();

    // 后台工作区 s1 的终端 t1 退出
    for (const handler of exitHandlers) {
      handler({ sessionId: "t1", exitCode: 0 });
    }
    // 当前视图（s2）不受影响
    expect(store.sessions.map((item) => item.id)).toEqual(["t9"]);
    expect(store.activeId).toBe("t9");

    // 切回 s1：t1 已摘除，t2 保留
    store.bindWorkspaceScope("s1");
    expect(store.sessions.map((item) => item.id)).toEqual(["t2"]);
    expect(store.names["t1"]).toBeUndefined();
  });

  it("底部面板已打开时切到空工作区，自动补一个终端；已有终端不重复创建", async () => {
    const create = vi.fn().mockImplementation(async () => ({
      ok: true,
      session: termOf(`t${create.mock.calls.length}`),
    }));
    vi.stubGlobal("zen", {
      terminal: { shell: vi.fn().mockResolvedValue({ path: "/bin/sh", args: [], label: "sh" }), create },
    });
    const layout = useLayoutStore();
    const store = useTerminalStore();
    store.bindWorkspaceScope("s1");
    layout.toggleBottom();
    await store.ensureForWorkspace();
    expect(store.sessions).toHaveLength(1);

    store.bindWorkspaceScope("s2");
    await vi.waitFor(() => expect(store.sessions).toHaveLength(1));
    expect(create).toHaveBeenCalledTimes(2);

    store.bindWorkspaceScope("s1");
    await store.ensureForWorkspace();
    expect(store.sessions).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);

    layout.toggleBottom();
    store.bindWorkspaceScope("s3");
    expect(store.sessions).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(2);
    layout.toggleBottom();
    await store.ensureForWorkspace();
    expect(store.sessions).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("当前工作区的活动终端退出：refs 清理（含命名摘除）", () => {
    const store = useTerminalStore();
    store.bindWorkspaceScope("s1");
    store.sessions = [termOf("t1"), termOf("t2")];
    store.activeId = "t1";
    store.paneIds = ["t1"];
    store.rename("t1", "dev");
    store.bindEvents();

    for (const handler of exitHandlers) {
      handler({ sessionId: "t1", exitCode: 1 });
    }
    expect(store.sessions.map((item) => item.id)).toEqual(["t2"]);
    expect(store.activeId).toBe("t2");
    expect(store.names["t1"]).toBeUndefined();
    // 退出提示写进缓冲（切回/重挂时可见）
    expect(store.getBuffer("t1")).toContain("1");
  });

  it("活动快照、推送与退出按终端 ID 同步，不把空闲 shell 计入", async () => {
    let onActivity: ((event: { terminalId: string; ownerSessionId: string | null; active: boolean }) => void) | undefined;
    let resolveSnapshot!: (items: Array<{ terminalId: string; ownerSessionId: string | null; active: boolean }>) => void;
    const listActivities = vi.fn(() => new Promise<Awaited<Parameters<typeof resolveSnapshot>[0]>>((resolve) => {
      resolveSnapshot = resolve;
    }));
    vi.stubGlobal("zen", {
      terminal: {
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn((handler: ExitHandler) => { exitHandlers.push(handler); return () => undefined; }),
        onActivity: vi.fn((handler: typeof onActivity) => { onActivity = handler; return () => undefined; }),
        listActivities,
      },
    });
    const store = useTerminalStore();
    store.bindEvents();
    onActivity?.({ terminalId: "t2", ownerSessionId: "s2", active: true });
    exitHandlers[0]?.({ sessionId: "old", exitCode: 0 });
    resolveSnapshot([
      { terminalId: "idle", ownerSessionId: "s1", active: false },
      { terminalId: "old", ownerSessionId: "s1", active: true },
      { terminalId: "t1", ownerSessionId: "s1", active: true },
    ]);
    await vi.waitFor(() => expect(store.activeActivities.map((item) => item.terminalId)).toEqual(["t1", "t2"]));
    onActivity?.({ terminalId: "t2", ownerSessionId: "s2", active: true });
    store.bindWorkspaceScope("different-workspace");
    expect(store.activeActivities.map((item) => item.terminalId)).toEqual(["t1", "t2"]);
    onActivity?.({ terminalId: "t1", ownerSessionId: "s1", active: false });
    exitHandlers[0]?.({ sessionId: "t2", exitCode: 0 });
    expect(store.activeActivities).toEqual([]);
  });

  it("新建及写入终端附带当前会话归属", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, session: termOf("t1") });
    const write = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("zen", {
      terminal: { shell: vi.fn().mockResolvedValue({ path: "/bin/zsh", args: [], label: "zsh" }), create, write },
    });
    const chat = useChatStore();
    chat.sessionId = "owner-session";
    const store = useTerminalStore();
    await store.start();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ ownerSessionId: "owner-session" }));
    await store.write("npm run dev\\r", "t1");
    expect(write).toHaveBeenCalledWith("t1", "npm run dev\\r", "owner-session");
  });
});
