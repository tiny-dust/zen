import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installAppLinkInterceptor, isOpenInAppBrowser, openAppLink } from "@/lib/open-link";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("@/stores/browser", () => ({
  useBrowserStore: () => ({ openUrl }),
}));

function stubZen(openExternal: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("zen", { app: { openExternal } });
}

describe("isOpenInAppBrowser", () => {
  it("http/https/协议相对走应用内浏览器", () => {
    expect(isOpenInAppBrowser("https://example.com")).toBe(true);
    expect(isOpenInAppBrowser("http://example.com")).toBe(true);
    expect(isOpenInAppBrowser("HTTPS://example.com")).toBe(true);
    expect(isOpenInAppBrowser("//example.com/a")).toBe(true);
  });

  it("空值与其它协议不走应用内", () => {
    expect(isOpenInAppBrowser("")).toBe(false);
    expect(isOpenInAppBrowser("   ")).toBe(false);
    expect(isOpenInAppBrowser("mailto:a@b.c")).toBe(false);
    expect(isOpenInAppBrowser("#top")).toBe(false);
    expect(isOpenInAppBrowser("file:///tmp/a.md")).toBe(false);
  });
});

describe("openAppLink", () => {
  beforeEach(() => {
    openUrl.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("空链接直接返回", async () => {
    const openExternal = vi.fn();
    stubZen(openExternal);
    await openAppLink("");
    await openAppLink("   ");
    expect(openUrl).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("http(s) 走右栏浏览器", async () => {
    stubZen(vi.fn());
    await openAppLink("https://example.com/a");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("协议相对补 https:", async () => {
    stubZen(vi.fn());
    await openAppLink("//example.com/a");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("其它协议走系统默认处理", async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    stubZen(openExternal);
    await openAppLink("mailto:a@b.c");
    expect(openExternal).toHaveBeenCalledWith("mailto:a@b.c");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("window.zen 缺失时不抛错", async () => {
    vi.unstubAllGlobals();
    await expect(openAppLink("mailto:a@b.c")).resolves.toBeUndefined();
  });
});

describe("installAppLinkInterceptor", () => {
  let uninstall: (() => void) | undefined;

  function mountAnchor(href: string): HTMLAnchorElement {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    document.body.appendChild(anchor);
    return anchor;
  }

  function install() {
    uninstall = installAppLinkInterceptor();
    return uninstall;
  }

  beforeEach(() => {
    openUrl.mockClear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.unstubAllGlobals();
  });

  it("拦截 web 链接点击：preventDefault 并走右栏浏览器", () => {
    stubZen(vi.fn());
    install();
    const anchor = mountAnchor("https://example.com/page");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/page");
  });

  it("锚点内的子元素点击也能命中", () => {
    stubZen(vi.fn());
    install();
    const anchor = mountAnchor("https://example.com/inner");
    const span = document.createElement("span");
    span.textContent = "点我";
    anchor.appendChild(span);
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/inner");
  });

  it("修饰键 / 右键放行", () => {
    stubZen(vi.fn());
    install();
    const anchor = mountAnchor("https://example.com/x");
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      anchor.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
      );
    }
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("已被其它处理器处理的事件不再拦截", () => {
    stubZen(vi.fn());
    // 先于拦截器注册，捕获阶段先行 preventDefault
    const blocker = (event: Event) => event.preventDefault();
    document.addEventListener("click", blocker, true);
    try {
      install();
      const anchor = mountAnchor("https://example.com/x");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(openUrl).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", blocker, true);
    }
  });

  it("非 web / 锚内链 / javascript: 不拦截", () => {
    stubZen(vi.fn());
    install();
    for (const href of ["mailto:a@b.c", "#top", "javascript:void(0)", ""]) {
      const anchor = mountAnchor(href);
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("无锚点或非元素 target 放行", () => {
    stubZen(vi.fn());
    install();
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("卸载后不再拦截", () => {
    stubZen(vi.fn());
    const off = install();
    off();
    uninstall = undefined;
    const anchor = mountAnchor("https://example.com/after");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
