import { describe, expect, it } from "vitest";

import { normalizeShortcutKey, shortcutKeyFromEvent, shortcutMatches } from "@zen/shared";

describe("normalizeShortcutKey", () => {
  it("规范 Cmd/Control/Option 别名并稳定排序修饰键", () => {
    expect(normalizeShortcutKey("control+shift+a")).toBe("Ctrl+Shift+A");
    expect(normalizeShortcutKey("shift+meta+enter")).toBe("Cmd+Shift+Enter");
    expect(normalizeShortcutKey("option+k")).toBe("Alt+K");
  });

  it("保留纯键与特殊键名", () => {
    expect(normalizeShortcutKey("Enter")).toBe("Enter");
    expect(normalizeShortcutKey(" ")).toBe("Space");
    expect(normalizeShortcutKey("ArrowUp")).toBe("Up");
  });
});

describe("shortcutMatches", () => {
  it("对等价的组合键匹配成功", () => {
    const event = {
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(shortcutKeyFromEvent(event)).toBe("Cmd+Enter");
    expect(shortcutMatches(event, "Cmd+Enter")).toBe(true);
    expect(shortcutMatches(event, "Command+Enter")).toBe(true);
  });

  it("修饰键与键不匹配时返回 false", () => {
    const event = {
      key: "k",
      metaKey: true,
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
    };
    expect(shortcutMatches(event, "Cmd+K")).toBe(false);
    expect(shortcutMatches(event, "Cmd+Alt+K")).toBe(true);
  });

  it("纯修饰键本身不构成快捷键", () => {
    expect(
      shortcutKeyFromEvent({ key: "Meta", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBeNull();
  });
});
