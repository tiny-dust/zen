import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FileContextMenu from "./FileContextMenu.vue";

interface MenuProps {
  path: string;
  kind?: "file" | "directory";
  x: number;
  y: number;
  root?: string;
}

function stubZen(overrides: Record<string, unknown> = {}) {
  const shell = {
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    showInFolder: vi.fn().mockResolvedValue({ ok: true }),
    platformInfo: vi.fn().mockResolvedValue({
      platform: "win32",
      showInFolderLabel: "在资源管理器中显示",
      openFolderLabel: "打开文件资源管理器",
    }),
    listOpeners: vi.fn(),
    openWith: vi.fn(),
    ...overrides,
  };
  (window as { zen?: unknown }).zen = { shell };
  return shell;
}

function mountMenu(props: Partial<MenuProps> = {}) {
  return mount(FileContextMenu, {
    props: { path: "src/a.ts", kind: "file", x: 100, y: 80, root: "/ws", ...props } as MenuProps,
    attachTo: document.body,
  });
}

function menuItemTexts(): Array<string | undefined> {
  return [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
}

/** 菜单 teleport 到 body，须从 document.body 取项并派发点击 */
function clickMenuItem(index: number) {
  const item = document.body.querySelectorAll('[role="menuitem"]')[index];
  if (!item) {
    throw new Error(`menu item #${index} not found`);
  }
  item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as { zen?: unknown }).zen;
});

describe("FileContextMenu", () => {
  it("teleports to body with both actions and platform labels", async () => {
    const zen = stubZen();
    const wrapper = mountMenu();
    await flushPromises();
    const menu = document.body.querySelector(".file-context-menu");
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("role")).toBe("menu");
    expect(menuItemTexts()).toEqual(["打开文件", "在资源管理器中显示"]);
    expect(zen.platformInfo).toHaveBeenCalled();
    wrapper.unmount();
    expect(document.body.querySelector(".file-context-menu")).toBeNull();
  });

  it("uses folder wording for directory refs", async () => {
    stubZen();
    const wrapper = mountMenu({ path: "packages/shared", kind: "directory" });
    await flushPromises();
    expect(menuItemTexts()).toEqual(["打开文件资源管理器", "在资源管理器中显示"]);
    wrapper.unmount();
  });

  it("opens the default app on the resolved path and closes", async () => {
    const zen = stubZen();
    const wrapper = mountMenu({ path: "src/a.ts#L12" });
    clickMenuItem(0);
    await flushPromises();
    expect(zen.openPath).toHaveBeenCalledWith("/ws/src/a.ts");
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("shows absolute refs as-is and reveals them in the folder", async () => {
    const zen = stubZen();
    const wrapper = mountMenu({ path: "/tmp/a.ts" });
    clickMenuItem(1);
    await flushPromises();
    expect(zen.showInFolder).toHaveBeenCalledWith("/tmp/a.ts");
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps open and reports the error when the shell call fails", async () => {
    const zen = stubZen({ openPath: vi.fn().mockResolvedValue({ ok: false, error: "文件不存在" }) });
    const wrapper = mountMenu();
    clickMenuItem(0);
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("文件不存在");
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(zen.openPath).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("closes on Escape and on outside mousedown", async () => {
    stubZen();
    const wrapper = mountMenu();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(2);
    wrapper.unmount();
  });
});
