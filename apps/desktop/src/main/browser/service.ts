import { BrowserWindow, shell } from "electron";

import type {
  BrowserActionResult,
  BrowserAgentBridge,
  BrowserOpenResult,
  BrowserViewBounds,
} from "@zen/shared";

import { delay, kernelLabels, withTimeout } from "./browser-utils";
import { BrowserContentApi } from "./browser-content";

export interface BrowserDebugInfo {
  hasView: boolean;
  hasWindow: boolean;
  contentView: boolean;
  bounds: BrowserViewBounds | null;
  wantVisible: boolean;
  viewBounds: Electron.Rectangle | null;
  viewVisible: boolean | null;
  state: string;
  url: string;
  pageId: number | null;
  debuggerAttached: boolean;
  electron: string;
  chrome: string;
}

/**
 * 产品内浏览器对外门面：页面导航与生命周期编排。
 * 实现按子域分层继承：browser-view（WebContentsView/状态）→ browser-cdp（CDP）→ browser-content（内容与动作）。
 */
export class BrowserService extends BrowserContentApi implements BrowserAgentBridge {
  /** localhost / IPv6 字面量：本地 dev server 常只监听 ::1 或 127.0.0.1，逐个候选重试 */
  private localhostCandidates(raw: string): string[] {
    const target = raw.trim();
    if (!target) {
      return [];
    }
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return [target];
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return [target];
    }
    const host = url.hostname.toLowerCase();
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0";
    if (!isLocalHost) {
      return [target];
    }
    const port = url.port ? `:${url.port}` : "";
    const path = `${url.pathname}${url.search}${url.hash}`;
    const proto = url.protocol;
    return [
      target,
      `${proto}//127.0.0.1${port}${path}`,
      `${proto}//[::1]${port}${path}`,
      `${proto}//localhost${port}${path}`,
    ];
  }

  async open(url: string): Promise<BrowserOpenResult> {
    const token = ++this.navigateToken;
    const candidates = this.localhostCandidates(url);
    try {
      const status = await this.ensureRunning();
      if (status.state === "error") {
        return { ok: false, url, title: "", error: status.error || "内嵌浏览器未就绪" };
      }
      const target = url.trim();
      if (!target) {
        return { ok: false, url, title: "", error: "地址为空" };
      }
      const wc = this.requireWebContents();

      if (!this.bounds || this.bounds.width < 2) {
        this.bounds = this.fallbackBounds();
      }
      this.wantVisible = true;
      this.applyBounds();

      this.setStatus({ error: undefined });
      let lastError: Error | null = null;
      for (const candidate of candidates) {
        try {
          await withTimeout(wc.loadURL(candidate), 15_000, "页面加载");
          if (token !== this.navigateToken) {
            return { ok: true, url: wc.getURL() || candidate, title: wc.getTitle() || "" };
          }
          this.refreshMetaSync(wc);
          this.applyBounds();
          return { ok: true, url: this.state.url || candidate, title: this.state.title };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // ERR_CONNECTION_REFUSED / 超时 → 换下一候选（IPv4/IPv6）
        }
      }
      throw lastError || new Error("打开页面失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开页面失败";
      const hint =
        /ERR_|超时|failed|refused|not allowed|无法/i.test(message) && candidates.length > 1
          ? `${message}（已尝试：${candidates.join(" / ")}）`
          : message;
      this.setStatus({ error: hint });
      return { ok: false, url, title: "", error: hint };
    }
  }

  async goBack(): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      if (!wc.canGoBack()) {
        return { ok: false, error: "没有可后退的历史" };
      }
      wc.goBack();
      await delay(150);
      this.refreshMetaSync(wc);
      return { ok: true, url: this.state.url, title: this.state.title };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "后退失败" };
    }
  }

  async goForward(): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      if (!wc.canGoForward()) {
        return { ok: false, error: "没有可前进的历史" };
      }
      wc.goForward();
      await delay(150);
      this.refreshMetaSync(wc);
      return { ok: true, url: this.state.url, title: this.state.title };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "前进失败" };
    }
  }

  async reload(ignoreCache = false): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      if (ignoreCache) {
        wc.reloadIgnoringCache();
      } else {
        wc.reload();
      }
      await delay(150);
      this.refreshMetaSync(wc);
      return { ok: true, url: this.state.url, title: this.state.title };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "刷新失败" };
    }
  }

  async openInSystemBrowser(url?: string): Promise<{ ok: boolean; error?: string }> {
    const target = (url || this.state.url || "").trim();
    if (!target || target === "about:blank") {
      return { ok: false, error: "当前没有可打开的地址" };
    }
    try {
      await shell.openExternal(target);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "无法打开系统浏览器" };
    }
  }

  focusHost(): { ok: boolean } {
    try {
      const viewWc =
        this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
      const win =
        this.hostWindow && !this.hostWindow.isDestroyed()
          ? this.hostWindow
          : BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.focus();
      }
      if (viewWc) {
        void viewWc
          .executeJavaScript("try { window.blur(); } catch (e) {}", true)
          .catch(() => undefined);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  debugInfo(): BrowserDebugInfo {
    let viewBounds: Electron.Rectangle | null = null;
    let viewVisible: boolean | null = null;
    try {
      if (this.view) {
        viewBounds = this.view.getBounds();
        viewVisible = this.view.getVisible();
      }
    } catch {
      // ignore
    }
    return {
      hasView: Boolean(this.view && !this.view.webContents.isDestroyed()),
      hasWindow: Boolean(this.hostWindow && !this.hostWindow.isDestroyed()),
      contentView:
        Boolean(this.hostWindow) &&
        typeof this.hostWindow?.contentView?.addChildView === "function",
      bounds: this.bounds,
      wantVisible: this.wantVisible,
      viewBounds,
      viewVisible,
      state: this.state.state,
      url: this.state.url,
      pageId: this.state.pageId,
      debuggerAttached: this.debuggerAttached,
      electron: process.versions.electron || "",
      chrome: process.versions.chrome || "",
    };
  }

  dispose(): void {
    void this.stopElementPick();
    this.teardownView();
    this.wantVisible = false;
    this.starting = null;
    this.setStatus({
      state: "stopped",
      pageId: null,
      url: "",
      title: "",
      picking: false,
      visible: false,
      canGoBack: false,
      canGoForward: false,
      ...kernelLabels(),
    });
  }

  kernelLabel(): string {
    const { chromeVersion, electronVersion } = kernelLabels();
    return `Electron ${electronVersion} / Chromium ${chromeVersion}`;
  }
}

let singleton: BrowserService | null = null;

export function getBrowserService(): BrowserService {
  if (!singleton) {
    singleton = new BrowserService();
  }
  return singleton;
}

export function shutdownBrowserService(): void {
  singleton?.dispose();
  singleton = null;
}
