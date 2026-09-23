import { BrowserWindow, WebContentsView } from "electron";

import type {
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserNetworkEntry,
  BrowserSettings,
  BrowserStatus,
  BrowserViewBounds,
} from "@zen/shared";
import { DEFAULT_BROWSER_SETTINGS } from "@zen/shared";

import { kernelLabels, withTimeout } from "./browser-utils";

type StatusListener = (status: BrowserStatus) => void;
type PickListener = (ref: BrowserElementRef) => void;

/**
 * 产品内浏览器底层：Electron WebContentsView。
 * 关键约束：launch 不得 await 可能挂起的 debugger 协议；所有 IPC 路径要有超时。
 * 状态字段与视图生命周期都收敛在本层，上层（browser-cdp / browser-content / service）按子域扩展。
 */
export class BrowserViewManager {
  protected state: BrowserStatus = {
    state: "stopped",
    ...kernelLabels(),
    pageId: null,
    url: "",
    title: "",
    picking: false,
    visible: false,
    pip: false,
    pipHidden: false,
    canGoBack: false,
    canGoForward: false,
  };
  protected hostWindow: BrowserWindow | null = null;
  protected view: WebContentsView | null = null;
  protected bounds: BrowserViewBounds | null = null;
  protected wantVisible = false;
  protected consoleBuffer: BrowserConsoleEntry[] = [];
  protected networkBuffer: BrowserNetworkEntry[] = [];
  protected statusListeners = new Set<StatusListener>();
  protected pickListeners = new Set<PickListener>();
  protected debuggerAttached = false;
  protected starting: Promise<BrowserStatus> | null = null;
  protected navigateToken = 0;
  /** 系统弹窗（sheet/文件选择）显示期间的压制计数，防止 WebContentsView 盖住弹窗 */
  protected dialogSuppress = 0;
  /** 浏览器设置（UA / 缩放），由 service 层从 ~/.zen/config.json 载入并应用 */
  protected settings: BrowserSettings = { ...DEFAULT_BROWSER_SETTINGS };
  /** 画中画模式：off=面板内；floating=悬浮窗；hidden=悬浮窗已关、页面后台运行 */
  protected pipMode: "off" | "floating" | "hidden" = "off";
  /** 画中画悬浮窗（floating 时存在） */
  protected pipWindow: BrowserWindow | null = null;
  /** 画中画顶栏高度（px），页面视图贴在其下方 */
  protected static readonly PIP_TOPBAR = 32;

  /** 应用浏览器设置：UA 持久生效；缩放作用于 webContents zoom（视图 bounds 仍由面板决定） */
  applyBrowserSettings(settings: BrowserSettings): void {
    this.settings = { ...settings };
    const wc = this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
    if (!wc) {
      return;
    }
    try {
      // 空串 = 恢复默认 UA；zoom 跨导航保持，无需在 did-navigate 重放
      wc.setUserAgent(this.settings.userAgent);
      wc.setZoomFactor(Math.min(3, Math.max(0.5, this.settings.zoomPercent / 100)));
    } catch {
      // 视图可能恰好销毁，忽略
    }
  }

  /** 是否处于画中画悬浮状态（主窗口 reload 自动隐藏逻辑需跳过） */
  isPipFloating(): boolean {
    return this.pipMode === "floating";
  }

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

  protected setStatus(patch: Partial<BrowserStatus>): void {
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

  /**
   * 弹窗期间隐藏内嵌浏览器视图：macOS sheet / 文件选择等系统弹窗层级低于
   * contentView 上的 WebContentsView，会整个被盖住。返回恢复函数，弹窗关闭后调用。
   */
  hideForDialog(): () => void {
    this.dialogSuppress += 1;
    this.applyBounds();
    return () => {
      this.dialogSuppress = Math.max(0, this.dialogSuppress - 1);
      this.applyBounds();
    };
  }

  protected applyBounds(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const b = this.bounds;
    const show = this.wantVisible && this.dialogSuppress === 0 && b && b.width > 1 && b.height > 1;
    try {
      // 画中画隐藏态：页面在后台运行，任何 bounds/可见性推送都不点亮视图
      if (this.pipMode === "hidden") {
        view.setVisible(false);
        this.setStatus({ visible: false, pip: false, pipHidden: true });
        return;
      }
      // 画中画悬浮态：视图贴满悬浮窗顶栏下方区域，忽略面板 bounds 推送
      if (this.pipMode === "floating") {
        const pip = this.pipWindow && !this.pipWindow.isDestroyed() ? this.pipWindow : null;
        if (!pip) {
          return;
        }
        const size = pip.getContentSize();
        const w = Number(size[0]) || 480;
        const h = Number(size[1]) || 300;
        view.setVisible(true);
        view.setBounds({
          x: 0,
          y: BrowserViewManager.PIP_TOPBAR,
          width: Math.max(40, w),
          height: Math.max(40, h - BrowserViewManager.PIP_TOPBAR),
        });
        this.setStatus({ visible: true, pip: true, pipHidden: false });
        return;
      }
      if (!show) {
        view.setVisible(false);
        this.setStatus({ visible: false, pip: false, pipHidden: false });
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
  protected fallbackBounds(): BrowserViewBounds | null {
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
      // 应用持久化设置（UA / 缩放）：新视图也要带上，重启后仍生效
      this.applyBrowserSettings(this.settings);
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
        // 页面被销毁时画中画可能仍悬浮着：一并关掉，避免留下空壳窗口
        if (this.pipWindow && !this.pipWindow.isDestroyed()) {
          try {
            this.pipWindow.destroy();
          } catch {
            // ignore
          }
        }
        this.pipWindow = null;
        this.pipMode = "off";
        this.setStatus({
          state: "stopped",
          pageId: null,
          visible: false,
          picking: false,
          pip: false,
          pipHidden: false,
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

  protected refreshMetaSync(wc: Electron.WebContents): void {
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

  protected async refreshMeta(): Promise<void> {
    const wc = this.requireWebContents();
    this.refreshMetaSync(wc);
  }

  protected pushConsole(entry: BrowserConsoleEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > 300) {
      this.consoleBuffer.splice(0, this.consoleBuffer.length - 300);
    }
  }

  protected requireWebContents(): Electron.WebContents {
    if (!this.view || this.view.webContents.isDestroyed()) {
      throw new Error("内嵌浏览器未启动");
    }
    return this.view.webContents;
  }

  protected async evalPage<T>(expression: string): Promise<T> {
    const wc = this.requireWebContents();
    return (await withTimeout(wc.executeJavaScript(expression, true), 8000, "页面脚本")) as T;
  }

  protected teardownView(): void {
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
}
