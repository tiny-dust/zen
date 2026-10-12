// 终端面板按 chat 会话分桶：切换恢复（PTY 不销毁）+ 后台桶内终端退出摘除。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalSessionInfo } from "@zen/shared";

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

describe("terminal bindChatSession 分桶", () => {
  it("切走再切回恢复终端列表 / 活动终端 / 命名 / 分屏", () => {
    const store = useTerminalStore();
    store.bindChatSession("s1");
    // 直接布置现场（绕过 IPC 创建路径）
    store.sessions = [termOf("t1"), termOf("t2")];
    store.activeId = "t2";
    store.rename("t1", "build");
    store.splitMode = "columns";
    store.paneIds = ["t1", "t2"];

    store.bindChatSession("s2");
    expect(store.sessions).toHaveLength(0);
    expect(store.activeId).toBe("");
    expect(store.splitMode).toBe("none");

    // 新会话里另有一组终端
    store.sessions = [termOf("t9")];
    store.activeId = "t9";

    store.bindChatSession("s1");
    expect(store.sessions.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(store.activeId).toBe("t2");
    expect(store.names["t1"]).toBe("build");
    expect(store.splitMode).toBe("columns");
    expect(store.paneIds).toEqual(["t1", "t2"]);
  });

  it("输出缓冲跨会话全局共享：切走再切回按 id 回放", () => {
    const store = useTerminalStore();
    store.bindChatSession("s1");
    store.bindEvents();
    // 模拟主进程 PTY 输出（含后台会话的终端）
    for (const handler of dataHandlers) {
      handler({ sessionId: "t1", data: "hello " });
      handler({ sessionId: "t1", data: "zen" });
    }
    // 缓冲跨会话全局共享：切走不销毁（后台终端继续写），切回直接按 id 读取
    store.bindChatSession("s2");
    for (const handler of dataHandlers) {
      handler({ sessionId: "t1", data: "!" });
    }
    store.bindChatSession("s1");
    expect(store.getBuffer("t1")).toBe("hello zen!");
  });

  it("后台会话桶里的终端退出：从对应桶摘除，切回后不再出现", () => {
    const store = useTerminalStore();
    store.bindChatSession("s1");
    store.sessions = [termOf("t1"), termOf("t2")];
    store.activeId = "t1";
    store.paneIds = ["t1"];

    // 切走：t1/t2 进入 s1 的桶；当前视图切到 s2（自己的一组终端）
    store.bindChatSession("s2");
    store.sessions = [termOf("t9")];
    store.activeId = "t9";
    store.paneIds = ["t9"];
    store.bindEvents();

    // 后台会话 s1 的终端 t1 退出
    for (const handler of exitHandlers) {
      handler({ sessionId: "t1", exitCode: 0 });
    }
    // 当前视图（s2）不受影响
    expect(store.sessions.map((item) => item.id)).toEqual(["t9"]);
    expect(store.activeId).toBe("t9");

    // 切回 s1：t1 已从桶里摘除，t2 保留
    store.bindChatSession("s1");
    expect(store.sessions.map((item) => item.id)).toEqual(["t2"]);
    expect(store.names["t1"]).toBeUndefined();
  });

  it("当前会话的活动终端退出：refs 清理（含命名摘除）", () => {
    const store = useTerminalStore();
    store.bindChatSession("s1");
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
});
