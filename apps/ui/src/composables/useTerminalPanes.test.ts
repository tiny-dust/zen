import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalPanes } from "@/composables/useTerminalPanes";

const { terms, observers } = vi.hoisted(() => ({
  terms: [] as Array<{ host?: HTMLElement; disposed: boolean; write: ReturnType<typeof vi.fn>; send: (data: string) => void }>,
  observers: [] as Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    host?: HTMLElement;
    disposed = false;
    cols = 80;
    rows = 24;
    options = { theme: {} };
    write = vi.fn();
    private data?: (value: string) => void;
    constructor() { terms.push(this); }
    loadAddon() {}
    open(host: HTMLElement) { this.host = host; }
    onData(handler: (value: string) => void) { this.data = handler; }
    send(data: string) { this.data?.(data); }
    focus() {}
    dispose() { this.disposed = true; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@/composables/useAppTheme", async () => {
  const { shallowRef } = await import("vue");
  return { useAppTheme: () => ({ isDark: shallowRef(false) }) };
});

const terminalStore = reactive({
  sessions: [] as Array<{ id: string }>,
  activeId: "",
  visibleSessions: [] as Array<{ id: string }>,
  splitMode: "none",
  fontInfo: { fontFamily: "monospace", fontSize: 12 },
  resize: vi.fn(async (_cols: number, _rows: number, _id: string) => {}),
  write: vi.fn(async (_data: string, _id: string) => {}),
  getBuffer: vi.fn((_id: string) => "old output"),
});
vi.mock("@/stores/terminal", () => ({ useTerminalStore: () => terminalStore }));

function createPane(visibleIds: () => string[]) {
  let pane!: ReturnType<typeof useTerminalPanes>;
  const wrapper = mount(defineComponent({
    setup() {
      pane = useTerminalPanes({ visibleIds });
      pane.startResizeObserver();
      return () => h("div");
    },
  }));
  return { pane, wrapper };
}

beforeEach(() => {
  terms.length = 0;
  observers.length = 0;
  terminalStore.sessions = [{ id: "one" }];
  terminalStore.activeId = "one";
  terminalStore.visibleSessions = [{ id: "one" }];
  terminalStore.resize.mockClear();
  terminalStore.write.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    observe() {}
    unobserve() {}
    constructor(private callback: () => void) { observers.push({ notify: () => this.callback(), disconnect: this.disconnect }); }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("useTerminalPanes 多视图", () => {
  it("相同 PTY 各自保有 xterm，聚焦的 view 独占 resize，两个 view 都可输入", async () => {
    const bottom = createPane(() => [terminalStore.activeId]);
    const right = createPane(() => [terminalStore.activeId]);
    const bottomHost = document.createElement("div");
    const rightHost = document.createElement("div");
    bottom.pane.setHostRef("one", bottomHost);
    right.pane.setHostRef("one", rightHost);
    await bottom.pane.mountVisible();
    await right.pane.mountVisible();
    expect(terms).toHaveLength(2);
    expect(terms[0]?.host).toBe(bottomHost);
    expect(terms[1]?.host).toBe(rightHost);
    expect(terms[0]?.write).toHaveBeenCalledWith("old output");
    expect(terms[1]?.write).toHaveBeenCalledWith("old output");

    terminalStore.resize.mockClear();
    observers[1]?.notify();
    expect(terminalStore.resize).not.toHaveBeenCalled();
    right.pane.focusPane("one");
    terminalStore.resize.mockClear();
    observers[0]?.notify();
    expect(terminalStore.resize).not.toHaveBeenCalled();
    observers[1]?.notify();
    expect(terminalStore.resize).toHaveBeenCalledWith(80, 24, "one");
    terms[0]?.send("a");
    terms[1]?.send("b");
    expect(terminalStore.write).toHaveBeenCalledWith("a", "one");
    expect(terminalStore.write).toHaveBeenCalledWith("b", "one");

    right.wrapper.unmount();
    expect(terms[1]?.disposed).toBe(true);
    expect(terms[0]?.disposed).toBe(false);
    terminalStore.resize.mockClear();
    observers[0]?.notify();
    expect(terminalStore.resize).toHaveBeenCalledWith(80, 24, "one");
    bottom.wrapper.unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
    expect(observers[1]?.disconnect).toHaveBeenCalled();
  });

  it("工作区切换销毁旧 view 并为新工作区回放缓冲", async () => {
    const right = createPane(() => terminalStore.activeId ? [terminalStore.activeId] : []);
    right.pane.setHostRef("one", document.createElement("div"));
    await right.pane.mountVisible();
    terminalStore.sessions = [{ id: "two" }];
    terminalStore.activeId = "two";
    right.pane.setHostRef("one", null);
    right.pane.setHostRef("two", document.createElement("div"));
    await flushPromises();
    expect(terms[0]?.disposed).toBe(true);
    expect(right.pane.entries.has("one")).toBe(false);
    expect(right.pane.entries.get("two")?.term).toBe(terms[1]);
    expect(terms[1]?.write).toHaveBeenCalledWith("old output");
    right.wrapper.unmount();
  });
});
