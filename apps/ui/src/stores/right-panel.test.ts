import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";

const setBounds = vi.fn(async () => undefined);

beforeEach(() => {
  setActivePinia(createPinia());
  setBounds.mockClear();
  vi.stubGlobal("zen", { browser: { setBounds } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRightPanelStore", () => {
  it("初始只有 files tab", () => {
    const store = useRightPanelStore();
    expect(store.tabs.map((item) => item.kind)).toEqual(["files"]);
    expect(store.activeId).toBe("files");
    expect(store.activeTab?.kind).toBe("files");
    expect(store.hasKind("files")).toBe(true);
    expect(store.hasKind("browser")).toBe(false);
  });

  it("activate 只接受已有 tab id", () => {
    const store = useRightPanelStore();
    store.ensureTab("browser");
    store.activate("files");
    expect(store.activeId).toBe("files");
    store.activate("nope");
    expect(store.activeId).toBe("files");
  });

  it("ensureTab 创建新 tab，重复调用只激活不重建", () => {
    const store = useRightPanelStore();
    const created = store.ensureTab("changes");
    expect(store.tabs.map((item) => item.kind)).toEqual(["files", "changes"]);
    expect(store.activeId).toBe("changes");
    expect(created.title).toBe("变更");

    const again = store.ensureTab("changes");
    expect(store.tabs).toHaveLength(2);
    expect(again.id).toBe(created.id);
    expect(store.activeId).toBe("changes");
  });

  it("ensureTab 顺带展开右栏", () => {
    const layout = useLayoutStore();
    layout.rightCollapsed = true;
    const store = useRightPanelStore();
    store.ensureTab("browser");
    expect(layout.rightCollapsed).toBe(false);
  });

  it("closeTab 最后一个 tab 不可关闭", () => {
    const store = useRightPanelStore();
    store.closeTab("files");
    expect(store.tabs).toHaveLength(1);
    expect(store.activeId).toBe("files");
  });

  it("closeTab 未知 id 无操作", () => {
    const store = useRightPanelStore();
    store.ensureTab("browser");
    store.closeTab("nope");
    expect(store.tabs).toHaveLength(2);
  });

  it("关闭活动 tab 时切到邻近 tab", () => {
    const store = useRightPanelStore();
    store.ensureTab("changes");
    store.ensureTab("graph");
    // tabs: files, changes, graph（active=graph）
    store.closeTab("graph");
    expect(store.activeId).toBe("changes");
    expect(store.tabs.map((item) => item.kind)).toEqual(["files", "changes"]);
  });

  it("关闭非活动 tab 保持当前激活", () => {
    const store = useRightPanelStore();
    store.ensureTab("changes");
    store.activate("files");
    store.closeTab("changes");
    expect(store.activeId).toBe("files");
    expect(store.tabs.map((item) => item.kind)).toEqual(["files"]);
  });

  it("关闭浏览器 tab 立即隐藏原生视图", async () => {
    const store = useRightPanelStore();
    store.ensureTab("browser");
    store.ensureTab("files");
    store.closeTab("browser");
    await Promise.resolve();
    expect(setBounds).toHaveBeenCalledWith(null, false);
    expect(store.hasKind("browser")).toBe(false);
  });

  it("setBounds 失败被吞掉，不影响关闭", async () => {
    setBounds.mockRejectedValueOnce(new Error("ipc down"));
    const store = useRightPanelStore();
    store.ensureTab("browser");
    store.ensureTab("files");
    expect(() => store.closeTab("browser")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(setBounds).toHaveBeenCalledWith(null, false);
  });

  it("activeId 指向缺失 tab 时 activeTab 为 null", () => {
    const store = useRightPanelStore();
    store.activeId = "ghost";
    expect(store.activeTab).toBeNull();
  });

  it("关闭非浏览器 tab 不碰原生视图", () => {
    const store = useRightPanelStore();
    store.ensureTab("changes");
    store.closeTab("changes");
    expect(setBounds).not.toHaveBeenCalled();
  });

  it("revealFile 记录待定位路径并确保 files tab", () => {
    const store = useRightPanelStore();
    store.ensureTab("browser");
    store.revealFile("/a/b.ts");
    expect(store.pendingReveal).toBe("/a/b.ts");
    expect(store.activeTab?.kind).toBe("files");
  });
});
