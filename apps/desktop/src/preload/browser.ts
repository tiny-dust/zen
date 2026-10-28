import { ipcRenderer } from "electron";

import type {
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserHistoryItem,
  BrowserImportSource,
  BrowserImportSourceId,
  BrowserOpenResult,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSettings,
  BrowserSnapshot,
  BrowserStatus,
  BrowserViewBounds,
  ImportedBookmark,
  PasswordImportResult,
  StoredPasswordEntry,
} from "@zen/shared";

/**
 * 内嵌浏览器按工作区（workspaceId）隔离。preload 是渲染层全部浏览器 IPC 的必经
 * 边界，在这里维护「当前工作区 scope」并附加到每次 invoke，主进程据此路由到
 * 对应工作区的浏览器服务（BrowserServiceRegistry）。
 *
 * scope 与 chat store 的 sessionWorkspaceId 同源，更新途径：
 * 1. 初始种子：localStorage 的 zen.activeWorkspace（chat store 初始化读取同一 key）；
 * 2. 会话切换：session.create / open / setWorkspace 的参数或返回值（见 preload/session.ts）；
 * 3. 右栏面板：RightPanel watch sessionWorkspaceId 调 setScope 主动校正。
 */
let browserScope = seedScope();

function seedScope(): string {
  try {
    // 画中画悬浮窗顶栏（data: URL，无 localStorage 访问权）等环境抛错时回落公共区；
    // 那里的调用由主进程按悬浮窗归属路由，不依赖该值
    return localStorage.getItem("zen.activeWorkspace") || "common";
  } catch {
    return "common";
  }
}

/** 会话工作区变化：更新本地 scope 并通知主进程切换活动浏览器服务（幂等） */
export function syncBrowserScope(workspaceId: string | null | undefined): void {
  const next =
    typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : "common";
  if (next === browserScope) {
    return;
  }
  browserScope = next;
  void ipcRenderer.invoke("browser:bind-scope", next).catch(() => undefined);
}

export const browserApi = {
  browser: {
    /** 渲染层主动校正当前工作区 scope（RightPanel 会话切换 watch 调用） */
    setScope(scope: string): void {
      syncBrowserScope(scope);
    },
    status(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:status", browserScope);
    },
    ensureRunning(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:ensure-running", browserScope);
    },
    stop(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:stop", browserScope);
    },
    setBounds(bounds: BrowserViewBounds | null, visible?: boolean): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:set-bounds", bounds, visible, browserScope);
    },
    setVisible(visible: boolean): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:set-visible", visible, browserScope);
    },
    open(url: string): Promise<BrowserOpenResult> {
      return ipcRenderer.invoke("browser:open", url, browserScope);
    },
    goBack(): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:go-back", browserScope);
    },
    goForward(): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:go-forward", browserScope);
    },
    reload(ignoreCache?: boolean): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:reload", ignoreCache, browserScope);
    },
    openExternal(url?: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("browser:open-external", url, browserScope);
    },
    /** 站点图标：主进程抓取并缓存，返回 data URL（失败为 null，UI 回退占位） */
    favicon(url: string): Promise<string | null> {
      return ipcRenderer.invoke("site:favicon", url);
    },
    focusHost(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("browser:focus-host", browserScope);
    },
    debug(): Promise<Record<string, unknown>> {
      return ipcRenderer.invoke("browser:debug", browserScope);
    },
    snapshot(): Promise<BrowserSnapshot> {
      return ipcRenderer.invoke("browser:snapshot", browserScope);
    },
    extract(): Promise<BrowserExtractResult> {
      return ipcRenderer.invoke("browser:extract", browserScope);
    },
    click(selector: string): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:click", selector, browserScope);
    },
    type(
      selector: string,
      text: string,
      options?: { submit?: boolean },
    ): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:type", selector, text, options, browserScope);
    },
    console(limit?: number): Promise<{ entries: BrowserConsoleEntry[] }> {
      return ipcRenderer.invoke("browser:console", limit, browserScope);
    },
    performance(): Promise<BrowserPerformanceMetrics> {
      return ipcRenderer.invoke("browser:performance", browserScope);
    },
    screenshot(): Promise<BrowserScreenshotResult> {
      return ipcRenderer.invoke("browser:screenshot", browserScope);
    },
    evaluate(expression: string): Promise<BrowserEvalResult> {
      return ipcRenderer.invoke("browser:evaluate", expression, browserScope);
    },
    pickStart(): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("browser:pick-start", browserScope);
    },
    pickStop(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("browser:pick-stop", browserScope);
    },
    getSettings(): Promise<BrowserSettings> {
      return ipcRenderer.invoke("browser:get-settings");
    },
    setSettings(partial: Partial<BrowserSettings>): Promise<BrowserSettings> {
      return ipcRenderer.invoke("browser:set-settings", partial);
    },
    pipEnter(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-enter", browserScope);
    },
    pipExit(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-exit", browserScope);
    },
    pipHide(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-hide", browserScope);
    },
    onStatus(handler: (status: BrowserStatus) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, status: BrowserStatus) => {
        handler(status);
      };
      ipcRenderer.on("browser:status", listener);
      return () => {
        ipcRenderer.removeListener("browser:status", listener);
      };
    },
    onElementPicked(handler: (ref: BrowserElementRef) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, ref: BrowserElementRef) => {
        handler(ref);
      };
      ipcRenderer.on("browser:element-picked", listener);
      return () => {
        ipcRenderer.removeListener("browser:element-picked", listener);
      };
    },
    /** 本机可导入的系统浏览器（存在数据文件的才返回） */
    importSources(): Promise<BrowserImportSource[]> {
      return ipcRenderer.invoke("browser:import-sources");
    },
    importBookmarks(
      sourceId: BrowserImportSourceId,
    ): Promise<{ ok: boolean; bookmarks: ImportedBookmark[]; error?: string }> {
      return ipcRenderer.invoke("browser:import-bookmarks", sourceId);
    },
    importHistory(
      sourceId: BrowserImportSourceId,
    ): Promise<{ ok: boolean; entries: BrowserHistoryItem[]; error?: string }> {
      return ipcRenderer.invoke("browser:import-history", sourceId);
    },
    /** 导入密码：主进程弹文件框选浏览器导出的 CSV */
    importPasswordsCsv(): Promise<PasswordImportResult> {
      return ipcRenderer.invoke("browser:import-passwords-csv");
    },
    listPasswords(): Promise<StoredPasswordEntry[]> {
      return ipcRenderer.invoke("browser:passwords-list");
    },
    /** 取单条明文密码（复制按钮触发） */
    revealPassword(id: string): Promise<string | null> {
      return ipcRenderer.invoke("browser:passwords-reveal", id);
    },
    removePassword(id: string): Promise<boolean> {
      return ipcRenderer.invoke("browser:passwords-remove", id);
    },
    clearPasswords(): Promise<boolean> {
      return ipcRenderer.invoke("browser:passwords-clear");
    },
  },
};
