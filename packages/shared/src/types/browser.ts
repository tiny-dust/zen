export type BrowserRunState = "stopped" | "starting" | "running" | "error";

/** 面板内嵌 WebContentsView 的布局矩形（相对窗口客户区） */
export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserStatus {
  state: BrowserRunState;
  /** 内嵌 Chromium 版本（Electron 自带，随 Zen 应用更新） */
  chromeVersion: string;
  electronVersion: string;
  /** 内核更新通道说明 */
  kernelSource: string;
  /** WebContents id（未创建时为 null） */
  pageId: number | null;
  url: string;
  title: string;
  picking: boolean;
  /** 视图是否贴合面板显示 */
  visible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
}

export interface BrowserHistoryItem {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserElementRef {
  selector: string;
  selectorCandidates: string[];
  tag: string;
  id: string;
  className: string;
  text: string;
  name: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  role: string;
  href: string;
  rect: { x: number; y: number; width: number; height: number };
  pageUrl: string;
  pageTitle: string;
}

export interface BrowserConsoleEntry {
  level: string;
  text: string;
  url?: string;
  line?: number;
  ts: number;
}

export interface BrowserNetworkEntry {
  method: string;
  url: string;
  status: number;
  mimeType?: string;
  durationMs?: number;
  failed?: boolean;
  errorText?: string;
}

export interface BrowserPerformanceMetrics {
  metrics: Record<string, number>;
  navigation?: {
    type: string;
    durationMs: number;
    domContentLoadedMs: number;
    loadMs: number;
    transferSize?: number;
    encodedBodySize?: number;
  };
  paint?: {
    firstPaintMs?: number;
    firstContentfulPaintMs?: number;
  };
}

export interface BrowserSnapshotNode {
  role: string;
  name: string;
  selector?: string;
  value?: string;
  children?: BrowserSnapshotNode[];
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  a11y: BrowserSnapshotNode | null;
  outline: string;
}

export interface BrowserExtractResult {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  inputs: Array<{
    selector: string;
    tag: string;
    type: string;
    name: string;
    placeholder: string;
    label: string;
  }>;
  buttons: Array<{ selector: string; text: string; disabled: boolean }>;
}

export interface BrowserOpenResult {
  ok: boolean;
  url: string;
  title: string;
  error?: string;
}

export interface BrowserActionResult {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
}

export interface BrowserScreenshotResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface BrowserEvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface BrowserAgentBridge {
  status(): Promise<BrowserStatus>;
  ensureRunning(): Promise<BrowserStatus>;
  open(url: string): Promise<BrowserOpenResult>;
  snapshot(): Promise<BrowserSnapshot>;
  extract(): Promise<BrowserExtractResult>;
  click(selector: string): Promise<BrowserActionResult>;
  type(
    selector: string,
    text: string,
    options?: { submit?: boolean },
  ): Promise<BrowserActionResult>;
  console(limit?: number): Promise<{ entries: BrowserConsoleEntry[] }>;
  performance(): Promise<BrowserPerformanceMetrics>;
  screenshot(): Promise<BrowserScreenshotResult>;
  evaluate(expression: string): Promise<BrowserEvalResult>;
}
