import { BrowserWindow, shell } from "electron";

import type {
  BrowserActionResult,
  BrowserAgentBridge,
  BrowserElementRef,
  BrowserOpenResult,
  BrowserSettings,
  BrowserStatus,
  BrowserViewBounds,
} from "@zen/shared";

import { BrowserAutofillApi } from "./browser-autofill";
import { delay, kernelLabels, withTimeout } from "./browser-utils";

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
  /** 本服务归属的工作区（workspaceId；公共区为 "common"） */
  scope: string;
}

/**
 * 产品内浏览器对外门面：页面导航与生命周期编排。
 * 实现按子域分层继承：browser-view（WebContentsView/状态）→ browser-cdp（CDP）→ browser-content（内容与动作）
 * → browser-pip（画中画悬浮窗）→ browser-autofill（密码填充）。
 * 每个工作区（scope）一个实例，由 BrowserServiceRegistry 多路复用（见文件底部）。
 */
export class BrowserService extends BrowserAutofillApi implements BrowserAgentBridge {
  /** 本服务归属的工作区 scope（workspaceId；公共区为 "common"），与渲染层浏览器分桶 key 一致 */
  readonly scope: string;

  constructor(scope: string) {
    super();
    this.scope = scope;
  }

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

      // 可见性一律由渲染层 bounds 推送（setBounds(rect, true)）驱动：无合法 bounds
      // （面板未开/未同步，如后台工作区的 agent 打开页面）时保持隐藏。
      // 旧实现在这里用 fallbackBounds 猜测矩形并强制点亮，会把视图亮在错误位置
      // 盖住其它面板/内容（遮挡 bug 根因之一）。
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
      scope: this.scope,
    };
  }

  dispose(): void {
    void this.stopElementPick();
    // 主窗口关闭/退出（will-quit → shutdownBrowserService）：画中画悬浮窗一并清理
    this.destroyPipWindow();
    this.pipMode = "off";
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
      pip: false,
      pipHidden: false,
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

/** 默认 scope：公共区（与渲染层 chat store 的 sessionWorkspaceId 兜底一致） */
const DEFAULT_BROWSER_SCOPE = "common";

function normalizeScope(key: unknown): string {
  return typeof key === "string" && key.trim() ? key.trim() : DEFAULT_BROWSER_SCOPE;
}

/**
 * 浏览器服务按工作区（workspaceId）多路复用，修复多会话串台：
 * - 每个工作区独立的 WebContentsView 与页面状态；切走的工作区视图隐藏、页面后台保留，
 *   切回由面板 bounds 推送重新点亮，不再互相覆盖；
 * - 仅当前（active）工作区的服务接收渲染层 bounds 推送；IPC 由 preload 附带 scope 路由；
 * - status / element-picked 事件只转发当前工作区的服务——其它工作区（后台 agent 等）
 *   的导航不会写进当前会话的地址栏/历史，也不会强制展开浏览器面板；
 * - UA / 缩放 / 画中画几何是全局设置（~/.zen/config.json），对所有服务统一应用。
 */
export class BrowserServiceRegistry {
  private services = new Map<string, BrowserService>();
  private activeKey = DEFAULT_BROWSER_SCOPE;
  private settings: BrowserSettings | null = null;
  private statusSink: ((status: BrowserStatus) => void) | null = null;
  private pickSink: ((ref: BrowserElementRef) => void) | null = null;
  /** 元素源码解析器（ipc.ts 注入）：拾取后按 sourceHints 定位工作区源码文件 */
  private elementSourceResolver:
    | ((scope: string, ref: BrowserElementRef) => Promise<BrowserElementRef | null>)
    | null = null;

  /** 渲染层事件出口（ipc.ts 注入 broadcast 门面） */
  setSinks(
    status: (status: BrowserStatus) => void,
    pick: (ref: BrowserElementRef) => void,
  ): void {
    this.statusSink = status;
    this.pickSink = pick;
  }

  /** 注册元素源码解析器：返回 null 表示未命中（按原 ref 广播） */
  setElementSourceResolver(
    fn: (scope: string, ref: BrowserElementRef) => Promise<BrowserElementRef | null>,
  ): void {
    this.elementSourceResolver = fn;
  }

  /** 切换当前工作区：旧工作区视图立即隐藏（画中画悬浮除外），页面后台保留 */
  bindScope(key: string): BrowserService {
    const next = normalizeScope(key);
    if (next !== this.activeKey) {
      const prev = this.services.get(this.activeKey);
      if (prev && !prev.isPipFloating()) {
        prev.setVisible(false);
      }
      this.activeKey = next;
    }
    return this.forScope(next);
  }

  /** 取指定工作区的服务（无则创建；key 缺省回落当前工作区） */
  forScope(key?: unknown): BrowserService {
    const scope = normalizeScope(key);
    let service = this.services.get(scope);
    if (!service) {
      service = new BrowserService(scope);
      if (this.settings) {
        service.applyBrowserSettings(this.settings);
      }
      // 事件门控：仅当前工作区的服务向渲染层转发，避免后台导航串台
      service.onStatus((status) => {
        if (scope === this.activeKey) {
          this.statusSink?.(status);
        }
      });
      service.onElementPicked((ref) => {
        if (scope !== this.activeKey) {
          return;
        }
        const resolver = this.elementSourceResolver;
        if (!resolver || !ref.sourceHints?.length) {
          this.pickSink?.(ref);
          return;
        }
        // 源码解析不阻塞拾取事件太久：成功拿到非 null 结果再广播增强后的 ref，
        // 失败/超时回退直接广播原 ref（route/domPath/sourceHints 仍保留）
        void withTimeout(resolver(scope, ref), 4000, "元素源码解析")
          .then((resolved) => {
            this.pickSink?.(resolved ?? ref);
          })
          .catch(() => {
            this.pickSink?.(ref);
          });
      });
      this.services.set(scope, service);
    }
    return service;
  }

  /** 当前工作区的服务（getBrowserService 的语义：用户正在看的浏览器） */
  active(): BrowserService {
    return this.forScope(this.activeKey);
  }

  /** 全局浏览器设置应用到全部服务；新建服务时沿用缓存 */
  applySettings(settings: BrowserSettings): void {
    this.settings = { ...settings };
    for (const service of this.services.values()) {
      service.applyBrowserSettings(this.settings);
    }
  }

  /** 画中画悬浮窗归属的服务（顶栏 IPC 按 sender 窗口路由） */
  serviceOwningPipWindow(win: BrowserWindow | null): BrowserService | null {
    if (!win) {
      return null;
    }
    for (const service of this.services.values()) {
      if (service.ownsPipWindow(win)) {
        return service;
      }
    }
    return null;
  }

  /** 丢弃并销毁指定工作区的服务（browser:stop）；key 缺省指当前工作区 */
  dropScope(key?: unknown): void {
    const scope = normalizeScope(key);
    const service = this.services.get(scope);
    if (service) {
      service.dispose();
      this.services.delete(scope);
    }
  }

  forEach(cb: (service: BrowserService) => void): void {
    for (const service of this.services.values()) {
      cb(service);
    }
  }

  disposeAll(): void {
    for (const service of this.services.values()) {
      service.dispose();
    }
    this.services.clear();
    this.activeKey = DEFAULT_BROWSER_SCOPE;
  }
}

let registry: BrowserServiceRegistry | null = null;

export function getBrowserRegistry(): BrowserServiceRegistry {
  if (!registry) {
    registry = new BrowserServiceRegistry();
  }
  return registry;
}

/**
 * 兼容旧调用方（agent 桥 / 系统弹窗保护 / 外链打开）：当前工作区的浏览器服务。
 * agent-runner 在 run 创建时捕获该实例——run 期间用户切走工作区后，agent 继续操作
 * 原工作区的浏览器（隔离正确），不会把页面开进当前工作区。
 */
export function getBrowserService(): BrowserService {
  return getBrowserRegistry().active();
}

export function shutdownBrowserService(): void {
  registry?.disposeAll();
  registry = null;
}

/** 渲染层 reload / 窗口重建：全部服务重新指向主窗口（画中画悬浮的服务不动） */
export function attachBrowserWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) {
    return;
  }
  getBrowserRegistry().forEach((service) => service.attachToWindow(win));
}

/** 渲染层 reload 期间隐藏全部工作区视图（画中画悬浮除外——视图挂在悬浮窗上） */
export function hideAllBrowserViews(): void {
  getBrowserRegistry().forEach((service) => {
    if (!service.isPipFloating()) {
      service.setVisible(false);
    }
  });
}
