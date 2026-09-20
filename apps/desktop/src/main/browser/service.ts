import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { BrowserWindow, WebContentsView, app, shell } from "electron";

import {
  ELEMENT_PICK_SCRIPT,
  ELEMENT_PICK_TEARDOWN,
  formatConsoleForPrompt,
  formatExtractForPrompt,
  formatPerformanceForPrompt,
  formatSnapshotForPrompt,
} from "@zen/tools-browser";

import type {
  BrowserActionResult,
  BrowserAgentBridge,
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserNetworkEntry,
  BrowserOpenResult,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSnapshot,
  BrowserStatus,
  BrowserViewBounds,
} from "@zen/shared";

type StatusListener = (status: BrowserStatus) => void;
type PickListener = (ref: BrowserElementRef) => void;

function screenshotDir(): string {
  try {
    return join(app.getPath("userData"), "screenshots");
  } catch {
    return join(homedir(), ".zen", "screenshots");
  }
}

function kernelLabels(): { chromeVersion: string; electronVersion: string; kernelSource: string } {
  return {
    chromeVersion: process.versions.chrome || "",
    electronVersion: process.versions.electron || "",
    kernelSource: "Electron 内嵌 Chromium，随 Zen 应用 electron-updater 联网更新",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
 * 产品内浏览器：Electron WebContentsView。
 * 关键约束：launch 不得 await 可能挂起的 debugger 协议；所有 IPC 路径要有超时。
 */
export class BrowserService implements BrowserAgentBridge {
  private state: BrowserStatus = {
    state: "stopped",
    ...kernelLabels(),
    pageId: null,
    url: "",
    title: "",
    picking: false,
    visible: false,
    canGoBack: false,
    canGoForward: false,
  };
  private hostWindow: BrowserWindow | null = null;
  private view: WebContentsView | null = null;
  private bounds: BrowserViewBounds | null = null;
  private wantVisible = false;
  private consoleBuffer: BrowserConsoleEntry[] = [];
  private networkBuffer: BrowserNetworkEntry[] = [];
  private statusListeners = new Set<StatusListener>();
  private pickListeners = new Set<PickListener>();
  private debuggerAttached = false;
  private starting: Promise<BrowserStatus> | null = null;
  private navigateToken = 0;

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onElementPicked(listener: PickListener): () => void {
    this.pickListeners.add(listener);
    return () => this.pickListeners.delete(listener);
  }

  status(): Promise<BrowserStatus> {
    return Promise.resolve(this.getStatus());
  }

  getStatus(): BrowserStatus {
    return { ...this.state };
  }

  private setStatus(patch: Partial<BrowserStatus>): void {
    this.state = { ...this.state, ...patch, ...kernelLabels() };
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }

  attachToWindow(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) {
      return;
    }
    this.hostWindow = win;
  }

  setBounds(bounds: BrowserViewBounds | null): void {
    this.bounds = bounds;
    this.applyBounds();
  }

  setVisible(visible: boolean): void {
    this.wantVisible = visible;
    this.applyBounds();
  }

  private applyBounds(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const b = this.bounds;
    const show = this.wantVisible && b && b.width > 1 && b.height > 1;
    try {
      if (!show) {
        view.setVisible(false);
        this.setStatus({ visible: false });
        return;
      }
      // 钳制：不允许盖住窗口 chrome（标题栏/交通灯区），也不越出合理范围
      const win = this.hostWindow && !this.hostWindow.isDestroyed() ? this.hostWindow : null;
      const size = win ? win.getContentSize() : ([2000, 1200] as [number, number]);
      const winW = Number(size[0]) || 2000;
      const winH = Number(size[1]) || 1200;
      const minTop = 40; // --titlebar-h 38 + 余量
      const rect = {
        x: Math.max(0, Math.min(Math.round(b.x), Math.max(0, winW - 50))),
        y: Math.max(minTop, Math.min(Math.round(b.y), Math.max(minTop, winH - 40))),
        width: Math.max(40, Math.min(Math.round(b.width), Math.max(40, winW))),
        height: Math.max(40, Math.min(Math.round(b.height), Math.max(40, winH - minTop))),
      };
      view.setVisible(true);
      view.setBounds(rect);
      view.setBounds(rect);
      this.setStatus({ visible: true });
    } catch (error) {
      this.setStatus({
        visible: false,
        error: error instanceof Error ? error.message : "设置浏览器视图区域失败",
      });
    }
  }

  /** 主进程侧兜底 bounds：右栏大致区域（渲染层未同步时） */
  private fallbackBounds(): BrowserViewBounds | null {
    const win = this.hostWindow && !this.hostWindow.isDestroyed() ? this.hostWindow : null;
    if (!win) {
      return null;
    }
    const size = win.getContentSize();
    const width = Number(size[0]) || 1200;
    const height = Number(size[1]) || 800;
    const panelWidth = Math.min(560, Math.max(280, Math.floor(width * 0.4)));
    return {
      x: Math.max(0, width - panelWidth + 8),
      y: 48,
      width: Math.max(200, panelWidth - 16),
      height: Math.max(200, height - 48 - 16),
    };
  }

  private requireWindow(): BrowserWindow {
    const win =
      this.hostWindow && !this.hostWindow.isDestroyed()
        ? this.hostWindow
        : BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      throw new Error("主窗口不可用");
    }
    this.hostWindow = win;
    return win;
  }

  async ensureRunning(): Promise<BrowserStatus> {
    if (this.state.state === "running" && this.view && !this.view.webContents.isDestroyed()) {
      this.applyBounds();
      return this.getStatus();
    }
    if (this.starting) {
      // 已有启动流程：最多再等 12s，避免无限挂起拖死 open
      return withTimeout(this.starting, 12_000, "浏览器启动");
    }
    this.starting = withTimeout(this.launch(), 12_000, "浏览器启动").finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<BrowserStatus> {
    this.setStatus({ state: "starting", error: undefined, ...kernelLabels() });
    try {
      const win = this.requireWindow();
      this.teardownView();

      if (typeof win.contentView?.addChildView !== "function") {
        throw new Error("当前 Electron 不支持 contentView.addChildView");
      }

      const view = new WebContentsView({
        webPreferences: {
          // 远程页面：关掉 sandbox，避免个别环境下 guest 网络/渲染异常
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
          webSecurity: true,
        },
      });
      this.view = view;
      win.contentView.addChildView(view);

      const wc = view.webContents;
      wc.setWindowOpenHandler((details) => {
        void wc.loadURL(details.url).catch(() => undefined);
        return { action: "deny" };
      });

      wc.on("page-title-updated", (event, title) => {
        event.preventDefault();
        this.setStatus({ title });
      });
      wc.on("did-navigate", (_event, url) => {
        this.setStatus({
          url,
          canGoBack: wc.canGoBack(),
          canGoForward: wc.canGoForward(),
        });
        this.consoleBuffer = [];
      });
      wc.on("did-navigate-in-page", (_event, url) => {
        this.setStatus({
          url,
          canGoBack: wc.canGoBack(),
          canGoForward: wc.canGoForward(),
        });
      });
      wc.on("did-finish-load", () => {
        this.refreshMetaSync(wc);
      });
      wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          // -3 ERR_ABORTED：重定向/用户取消，不算失败
          return;
        }
        this.setStatus({
          error: `${errorDescription || "页面加载失败"}（${errorCode}）${validatedURL || ""}`,
        });
      });
      wc.on("console-message", (_event, level, message, line, sourceId) => {
        const levelName =
          typeof level === "number"
            ? (["verbose", "info", "warning", "error"] as const)[level] || "log"
            : String(level);
        this.pushConsole({
          level: levelName,
          text: String(message),
          url: sourceId,
          line,
          ts: Date.now(),
        });
      });
      wc.on("destroyed", () => {
        this.view = null;
        this.debuggerAttached = false;
        this.setStatus({
          state: "stopped",
          pageId: null,
          visible: false,
          picking: false,
        });
      });

      // 不在 launch 路径 attach debugger（协议 await 可能永久挂起）
      this.debuggerAttached = false;

      this.setStatus({
        state: "running",
        pageId: wc.id,
        url: wc.getURL() || "about:blank",
        title: wc.getTitle() || "",
        picking: false,
        error: undefined,
      });

      // 立刻给一个可见区域，避免「已 running 但 0 尺寸」
      if (!this.bounds) {
        this.bounds = this.fallbackBounds();
      }
      this.wantVisible = true;
      this.applyBounds();

      // 预热 about:blank，验证 guest 可加载（失败不阻断）
      try {
        await withTimeout(wc.loadURL("about:blank"), 3000, "预热 about:blank");
      } catch (error) {
        console.warn("[zen-browser] warmup about:blank failed", error);
      }

      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "内嵌浏览器启动失败";
      this.setStatus({ state: "error", error: message });
      return this.getStatus();
    }
  }

  private refreshMetaSync(wc: Electron.WebContents): void {
    try {
      this.setStatus({
        url: wc.getURL(),
        title: wc.getTitle(),
        pageId: wc.id,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        error: undefined,
      });
    } catch {
      // ignore
    }
  }

  private async refreshMeta(): Promise<void> {
    const wc = this.requireWebContents();
    this.refreshMetaSync(wc);
  }

  private pushConsole(entry: BrowserConsoleEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > 300) {
      this.consoleBuffer.splice(0, this.consoleBuffer.length - 300);
    }
  }

  private requireWebContents(): Electron.WebContents {
    if (!this.view || this.view.webContents.isDestroyed()) {
      throw new Error("内嵌浏览器未启动");
    }
    return this.view.webContents;
  }

  private async evalPage<T>(expression: string): Promise<T> {
    const wc = this.requireWebContents();
    return (await withTimeout(wc.executeJavaScript(expression, true), 8000, "页面脚本")) as T;
  }

  /** 懒挂载 CDP，带超时；失败不阻断浏览 */
  private async ensureDebugger(timeoutMs = 3000): Promise<boolean> {
    const wc = this.requireWebContents();
    if (this.debuggerAttached && wc.debugger.isAttached()) {
      return true;
    }
    try {
      if (wc.debugger.isAttached()) {
        try {
          wc.debugger.detach();
        } catch {
          // ignore
        }
      }
      await withTimeout(Promise.resolve(wc.debugger.attach("1.3")), timeoutMs, "CDP attach");
      wc.debugger.on("message", (_event, method, params) => {
        this.handleDebuggerEvent(method, params);
      });
      this.debuggerAttached = true;
      return true;
    } catch (error) {
      console.warn("[zen-browser] debugger attach failed", error);
      this.debuggerAttached = false;
      return false;
    }
  }

  private handleDebuggerEvent(method: string, params: unknown): void {
    if (method === "Runtime.consoleAPICalled") {
      const payload = params as {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        stackTrace?: { callFrames?: Array<{ url?: string; lineNumber?: number }> };
      };
      const text = (payload.args ?? [])
        .map((arg) => (arg.value != null ? String(arg.value) : (arg.description || "")))
        .join(" ");
      const frame = payload.stackTrace?.callFrames?.[0];
      this.pushConsole({
        level: payload.type || "log",
        text,
        url: frame?.url,
        line: frame?.lineNumber,
        ts: Date.now(),
      });
      return;
    }
    if (method === "Runtime.bindingCalled") {
      const payload = params as { name?: string; payload?: string };
      if (payload.name === "zenElementPicked" && typeof payload.payload === "string") {
        try {
          const ref = JSON.parse(payload.payload) as BrowserElementRef;
          this.setStatus({ picking: false });
          for (const listener of this.pickListeners) {
            listener(ref);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  private async sendDebugger<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 4000,
  ): Promise<T> {
    if (!(await this.ensureDebugger())) {
      throw new Error("CDP 不可用");
    }
    const wc = this.requireWebContents();
    return (await withTimeout(
      Promise.resolve(wc.debugger.sendCommand(method, params)),
      timeoutMs,
      `CDP ${method}`,
    )) as T;
  }

  async open(url: string): Promise<BrowserOpenResult> {
    const token = ++this.navigateToken;
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
      // loadURL：超时要有明确失败，避免 UI 一直「加载中」
      await withTimeout(wc.loadURL(target), 15_000, "页面加载");
      if (token !== this.navigateToken) {
        return { ok: true, url: wc.getURL() || target, title: wc.getTitle() || "" };
      }
      this.refreshMetaSync(wc);
      this.applyBounds();
      return { ok: true, url: this.state.url || target, title: this.state.title };
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开页面失败";
      this.setStatus({ error: message });
      return { ok: false, url, title: "", error: message };
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

  async snapshot(): Promise<BrowserSnapshot> {
    await this.ensureRunning();
    await this.refreshMeta();
    return this.evalPage<BrowserSnapshot>(`(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map((a) => ({
        text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
        href: a.href,
      }));
      const text = (document.body?.innerText || '').slice(0, 12000);
      const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,nav,main,section,button,input,textarea,select,a'))
        .slice(0, 120)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
          return tag + (label ? ': ' + label : '');
        });
      return {
        url: location.href,
        title: document.title,
        text,
        links,
        outline: nodes.join('\\n'),
        a11y: null,
      };
    })()`);
  }

  async extract(): Promise<BrowserExtractResult> {
    await this.ensureRunning();
    await this.refreshMeta();
    return this.evalPage<BrowserExtractResult>(`(() => {
      function sel(el) {
        if (el.id && !/^\\d/.test(el.id)) return '#' + CSS.escape(el.id);
        const testId = el.getAttribute('data-testid');
        if (testId) return '[data-testid="' + testId + '"]';
        const name = el.getAttribute('name');
        if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
        return el.tagName.toLowerCase();
      }
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).slice(0, 40).map((el) => ({
        selector: sel(el),
        text: (el.textContent || el.getAttribute('value') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
        disabled: Boolean(el.disabled),
      }));
      const inputs = Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 40).map((el) => {
        let label = '';
        const id = el.id;
        if (id) {
          const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
          if (lab) label = (lab.textContent || '').trim();
        }
        return {
          selector: sel(el),
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          placeholder: el.getAttribute('placeholder') || '',
          label,
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 12000),
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map((a) => ({
          text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
          href: a.href,
        })),
        inputs,
        buttons,
      };
    })()`);
  }

  async click(selector: string): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      const value = await this.evalPage<BrowserActionResult>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector not found' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return { ok: true, url: location.href, title: document.title };
      })()`);
      if (value?.ok) {
        this.setStatus({ url: value.url || this.state.url, title: value.title || this.state.title });
      }
      return value ?? { ok: false, error: "click failed" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "click failed" };
    }
  }

  async type(
    selector: string,
    text: string,
    options?: { submit?: boolean },
  ): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      return await this.evalPage<BrowserActionResult>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector not found' };
        el.focus();
        if ('value' in el) {
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = ${JSON.stringify(text)};
        }
        if (${options?.submit ? "true" : "false"}) {
          const form = el.form || el.closest('form');
          if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        return { ok: true, url: location.href, title: document.title };
      })()`);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "type failed" };
    }
  }

  async console(limit = 50): Promise<{ entries: BrowserConsoleEntry[] }> {
    return { entries: this.consoleBuffer.slice(-limit) };
  }

  async performance(): Promise<BrowserPerformanceMetrics> {
    await this.ensureRunning();
    const metricsResult = await this.sendDebugger<{
      metrics: Array<{ name: string; value: number }>;
    }>("Performance.getMetrics");
    const metrics: Record<string, number> = {};
    for (const item of metricsResult.metrics || []) {
      metrics[item.name] = item.value;
    }

    let navigation: BrowserPerformanceMetrics["navigation"];
    let paint: BrowserPerformanceMetrics["paint"];
    try {
      const value = await this.evalPage<{
        navigation?: BrowserPerformanceMetrics["navigation"];
        paint?: BrowserPerformanceMetrics["paint"];
      }>(`(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paints = performance.getEntriesByType('paint');
        const fcp = paints.find((p) => p.name === 'first-contentful-paint');
        const fp = paints.find((p) => p.name === 'first-paint');
        return {
          navigation: nav ? {
            type: nav.type,
            durationMs: nav.duration,
            domContentLoadedMs: nav.domContentLoadedEventEnd,
            loadMs: nav.loadEventEnd,
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
          } : null,
          paint: {
            firstPaintMs: fp ? fp.startTime : undefined,
            firstContentfulPaintMs: fcp ? fcp.startTime : undefined,
          },
        };
      })()`);
      navigation = value?.navigation ?? undefined;
      paint = value?.paint ?? undefined;
    } catch {
      // optional
    }

    return { metrics, navigation, paint };
  }

  async screenshot(): Promise<BrowserScreenshotResult> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      const image = await withTimeout(wc.capturePage(), 8000, "截图");
      const dir = screenshotDir();
      await mkdir(dir, { recursive: true });
      const path = join(dir, `zen-browser-${Date.now()}.png`);
      await writeFile(path, image.toPNG());
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "screenshot failed" };
    }
  }

  async evaluate(expression: string): Promise<BrowserEvalResult> {
    try {
      await this.ensureRunning();
      const value = await this.evalPage<unknown>(expression);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "evaluate failed" };
    }
  }

  async startElementPick(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      const attached = await this.ensureDebugger(3000);
      await withTimeout(wc.executeJavaScript(ELEMENT_PICK_SCRIPT, true), 4000, "启动标注");
      this.setStatus({ picking: true });
      if (!attached) {
        return { ok: true };
      }
      try {
        await this.sendDebugger("Runtime.addBinding", { name: "zenElementPicked" }, 2000);
      } catch {
        // binding optional
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "无法启动标注" };
    }
  }

  async stopElementPick(): Promise<{ ok: boolean }> {
    try {
      if (this.view && !this.view.webContents.isDestroyed()) {
        await withTimeout(
          Promise.resolve(this.view.webContents.executeJavaScript(ELEMENT_PICK_TEARDOWN, true)),
          2000,
          "停止标注",
        ).catch(() => undefined);
      }
    } catch {
      // ignore
    }
    this.setStatus({ picking: false });
    return { ok: true };
  }

  async consoleText(limit = 40): Promise<string> {
    const { entries } = await this.console(limit);
    return formatConsoleForPrompt(entries, limit);
  }

  async performanceText(): Promise<string> {
    return formatPerformanceForPrompt(await this.performance());
  }

  async snapshotText(): Promise<string> {
    return formatSnapshotForPrompt(await this.snapshot());
  }

  async extractText(): Promise<string> {
    return formatExtractForPrompt(await this.extract());
  }

  async networkEntries(limit = 30): Promise<BrowserNetworkEntry[]> {
    return this.networkBuffer.slice(-limit);
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

  private teardownView(): void {
    const view = this.view;
    this.view = null;
    this.debuggerAttached = false;
    if (!view) {
      return;
    }
    try {
      const wc = view.webContents;
      if (!wc.isDestroyed()) {
        if (wc.debugger.isAttached()) {
          try {
            wc.debugger.detach();
          } catch {
            // ignore
          }
        }
        const closable = wc as Electron.WebContents & { close?: () => void };
        if (typeof closable.close === "function") {
          closable.close();
        }
      }
    } catch {
      // ignore
    }
    try {
      const win = this.hostWindow;
      if (win && !win.isDestroyed()) {
        win.contentView.removeChildView(view);
      }
    } catch {
      // ignore
    }
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
