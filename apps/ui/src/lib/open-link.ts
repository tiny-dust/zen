import { useBrowserStore } from "@/stores/browser";

/** 判断是否应走应用内右栏浏览器（http/https/协议相对） */
export function isOpenInAppBrowser(url: string): boolean {
  const value = (url || "").trim();
  if (!value) {
    return false;
  }
  return /^https?:\/\//i.test(value) || value.startsWith("//");
}

/**
 * 应用内统一打开链接：
 * - http(s) → 右侧浏览器面板
 * - 其它协议（mailto 等）→ 系统默认处理
 */
export async function openAppLink(url: string): Promise<void> {
  const value = (url || "").trim();
  if (!value) {
    return;
  }
  if (isOpenInAppBrowser(value)) {
    const browser = useBrowserStore();
    await browser.openUrl(value.startsWith("//") ? `https:${value}` : value);
    return;
  }
  await window.zen?.app.openExternal(value);
}

/** 在文档捕获阶段拦截 `<a href>`，统一走右栏浏览器，避免 Electron 把主窗口导航走 */
export function installAppLinkInterceptor(): () => void {
  function onClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest?.("a[href]");
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      return;
    }
    // 本地文件 chip 有自己的处理；仅拦 web 链接
    if (!isOpenInAppBrowser(href)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openAppLink(href);
  }

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
