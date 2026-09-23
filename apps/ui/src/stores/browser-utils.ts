import type { BrowserExtractResult, BrowserStatus } from "@zen/shared";

export const emptyStatus = (): BrowserStatus => ({
  state: "stopped",
  chromeVersion: "",
  electronVersion: "",
  kernelSource: "",
  pageId: null,
  url: "",
  title: "",
  picking: false,
  visible: false,
  pip: false,
  pipHidden: false,
  canGoBack: false,
  canGoForward: false,
});

/** 非空输入补全为可导航 URL；非地址输入转为搜索引擎 */
export function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if (/^(https?:\/\/|about:|file:)/i.test(value)) {
    return value;
  }
  if (/^localhost(:\d+)?(\/|$)/i.test(value) || /^127\.0\.0\.1(:\d+)?(\/|$)/.test(value) || /^\[::1\](:\d+)?(\/|$)/i.test(value)) {
    // 保留原始 host（含 [::1]），主进程会按 IPv4/IPv6 候选重试
    return `http://${value}`;
  }
  // 域名启发式（含路径）
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(value) && !/\s/.test(value)) {
    return `https://${value}`;
  }
  // 其它输入（中文/关键词）→ 搜索，避免 loadURL 拒绝后「毫无反应」
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

/** extract 结果 → 插入输入框的页面上下文文本 */
export function buildPageContextText(extract: BrowserExtractResult): string {
  return [
    `[浏览器页面] ${extract.title} — ${extract.url}`,
    extract.buttons
      .slice(0, 6)
      .map((item) => `按钮 ${item.selector}：“${item.text}”`)
      .join("\n"),
    extract.inputs.slice(0, 6).map((item) => `输入框 ${item.selector}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
