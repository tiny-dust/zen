import { describe, expect, it, vi } from "vitest";

import { shortcutToAccelerator } from "./global-shortcuts";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
}));

describe("shortcutToAccelerator", () => {
  it("Cmd 组合键转换为 CmdOrCtrl（三平台归一）", () => {
    expect(shortcutToAccelerator("Cmd+P")).toBe("CmdOrCtrl+P");
    expect(shortcutToAccelerator("Shift+Cmd+P")).toBe("Shift+CmdOrCtrl+P");
    expect(shortcutToAccelerator("Cmd+,")).toBe("CmdOrCtrl+,");
  });

  it("Ctrl / Alt / Shift 组合键按 accelerator 规范写法输出", () => {
    expect(shortcutToAccelerator("Ctrl+`")).toBe("Control+`");
    expect(shortcutToAccelerator("Ctrl+Alt+Delete")).toBe("Control+Alt+Delete");
    expect(shortcutToAccelerator("Alt+Space")).toBe("Alt+Space");
  });

  it("多字符键映射到 accelerator 键名", () => {
    expect(shortcutToAccelerator("Cmd+Enter")).toBe("CmdOrCtrl+Return");
    expect(shortcutToAccelerator("Cmd+Up")).toBe("CmdOrCtrl+Up");
    expect(shortcutToAccelerator("Cmd+PageDown")).toBe("CmdOrCtrl+PageDown");
  });

  it("裸键（无修饰键）拒绝注册，避免吞掉系统单键输入", () => {
    expect(shortcutToAccelerator("Enter")).toBeNull();
    expect(shortcutToAccelerator("P")).toBeNull();
  });

  it("空串与非法输入返回 null", () => {
    expect(shortcutToAccelerator("")).toBeNull();
    expect(shortcutToAccelerator("+ +")).toBeNull();
  });
});
