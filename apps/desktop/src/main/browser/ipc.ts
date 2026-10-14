import { BrowserWindow, ipcMain } from "electron";

import type {
  BrowserActionResult,
  BrowserAgentBridge,
  BrowserElementRef,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserOpenResult,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSettings,
  BrowserSnapshot,
  BrowserStatus,
  BrowserViewBounds,
} from "@zen/shared";
import { getBrowserRegistry, type BrowserService } from "./service";
import { loadBrowserSettings, saveBrowserSettings } from "../zen-dir";

export function registerBrowserIpc(
  broadcast: (channel: string, payload: unknown) => void,
): BrowserAgentBridge {
  const registry = getBrowserRegistry();

  // 全局浏览器设置（UA/缩放/画中画几何，~/.zen/config.json）载入后对所有工作区服务生效
  void loadBrowserSettings()
    .then((settings) => registry.applySettings(settings))
    .catch(() => undefined);

  // 事件门控转发（registry 内按 active scope 过滤）：其它工作区（后台 agent 等）
  // 的导航不更新渲染层 store，也就不会在无关会话里改地址栏/历史、强开浏览器面板。
  // try-catch：渲染帧销毁瞬间（render-process-gone → dispose 链）webContents.send
  // 会抛 Render frame was disposed，事件转发失败不应中断 dispose
  registry.setSinks(
    (status) => {
      try {
        broadcast("browser:status", status);
      } catch {
        // ignore
      }
    },
    (ref: BrowserElementRef) => {
      try {
        broadcast("browser:element-picked", ref);
      } catch {
        // ignore
      }
    },
  );

  /**
   * 调用方服务解析（多工作区路由）：
   * 1. 画中画悬浮窗（顶栏按钮）发出的调用 → 按悬浮窗归属的服务路由；
   * 2. 其余按 preload 附带的 workspace scope 路由（缺省回落当前工作区）。
   */
  function serviceFor(event: Electron.IpcMainInvokeEvent, scope?: unknown): BrowserService {
    const owner = registry.serviceOwningPipWindow(BrowserWindow.fromWebContents(event.sender));
    if (owner) {
      return owner;
    }
    return registry.forScope(scope);
  }

  /** 把服务挂到发送方所在窗口（画中画悬浮窗发出的调用不重挂 host） */
  function attachHost(event: Electron.IpcMainInvokeEvent, service: BrowserService): void {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !registry.serviceOwningPipWindow(win)) {
      service.attachToWindow(win);
    }
  }

  // 工作区切换：preload 在会话切换（session.create/open/setWorkspace）与右栏面板
  // watch 时推送；主进程隐藏旧工作区视图、切换事件门控的活动 scope
  ipcMain.handle("browser:bind-scope", (_event, scope: string): BrowserStatus => {
    return registry.bindScope(scope).getStatus();
  });

  ipcMain.handle("browser:status", (_event, scope?: string): BrowserStatus => {
    return registry.forScope(scope).getStatus();
  });

  ipcMain.handle("browser:ensure-running", async (event, scope?: string): Promise<BrowserStatus> => {
    const service = serviceFor(event, scope);
    attachHost(event, service);
    return service.ensureRunning();
  });

  ipcMain.handle("browser:stop", async (_event, scope?: string): Promise<BrowserStatus> => {
    const service = registry.forScope(scope);
    registry.dropScope(scope);
    return service.getStatus();
  });

  ipcMain.handle(
    "browser:set-bounds",
    async (_event, bounds: BrowserViewBounds | null, visible?: boolean, scope?: string) => {
      const service = registry.forScope(scope);
      if (bounds && typeof bounds.x === "number") {
        service.setBounds(bounds);
      }
      if (typeof visible === "boolean") {
        service.setVisible(visible);
      } else if (bounds) {
        service.setVisible(true);
      }
      return service.getStatus();
    },
  );

  ipcMain.handle(
    "browser:set-visible",
    async (_event, visible: boolean, scope?: string) => {
      const service = registry.forScope(scope);
      service.setVisible(Boolean(visible));
      return service.getStatus();
    },
  );

  ipcMain.handle("browser:open", async (event, url: string, scope?: string): Promise<BrowserOpenResult> => {
    const service = serviceFor(event, scope);
    attachHost(event, service);
    return service.open(url);
  });

  ipcMain.handle("browser:go-back", async (_event, scope?: string) =>
    registry.forScope(scope).goBack(),
  );
  ipcMain.handle("browser:go-forward", async (_event, scope?: string) =>
    registry.forScope(scope).goForward(),
  );
  ipcMain.handle("browser:reload", async (_event, ignoreCache?: boolean, scope?: string) =>
    registry.forScope(scope).reload(Boolean(ignoreCache)),
  );
  ipcMain.handle("browser:open-external", async (_event, url?: string, scope?: string) =>
    registry.forScope(scope).openInSystemBrowser(url),
  );
  ipcMain.handle("browser:focus-host", async (_event, scope?: string) =>
    registry.forScope(scope).focusHost(),
  );
  ipcMain.handle("browser:debug", async (_event, scope?: string) =>
    registry.forScope(scope).debugInfo(),
  );

  ipcMain.handle("browser:snapshot", async (event, scope?: string): Promise<BrowserSnapshot> => {
    const service = serviceFor(event, scope);
    attachHost(event, service);
    return service.snapshot();
  });

  ipcMain.handle("browser:extract", async (event, scope?: string): Promise<BrowserExtractResult> => {
    const service = serviceFor(event, scope);
    attachHost(event, service);
    return service.extract();
  });

  ipcMain.handle(
    "browser:click",
    async (_event, selector: string, scope?: string): Promise<BrowserActionResult> => {
      return registry.forScope(scope).click(selector);
    },
  );

  ipcMain.handle(
    "browser:type",
    async (
      _event,
      selector: string,
      text: string,
      options?: { submit?: boolean },
      scope?: string,
    ): Promise<BrowserActionResult> => {
      return registry.forScope(scope).type(selector, text, options);
    },
  );

  ipcMain.handle("browser:console", async (_event, limit?: number, scope?: string) => {
    return registry.forScope(scope).console(limit);
  });

  ipcMain.handle("browser:performance", async (_event, scope?: string): Promise<BrowserPerformanceMetrics> => {
    return registry.forScope(scope).performance();
  });

  ipcMain.handle("browser:screenshot", async (_event, scope?: string): Promise<BrowserScreenshotResult> => {
    return registry.forScope(scope).screenshot();
  });

  ipcMain.handle(
    "browser:evaluate",
    async (_event, expression: string, scope?: string): Promise<BrowserEvalResult> => {
      return registry.forScope(scope).evaluate(expression);
    },
  );

  ipcMain.handle("browser:pick-start", async (event, scope?: string) => {
    const service = serviceFor(event, scope);
    attachHost(event, service);
    return service.startElementPick();
  });
  ipcMain.handle("browser:pick-stop", async (_event, scope?: string) =>
    registry.forScope(scope).stopElementPick(),
  );

  // ===== 浏览器设置（UA / 缩放，全局共享）与画中画 =====
  ipcMain.handle("browser:get-settings", async () => loadBrowserSettings());

  ipcMain.handle("browser:set-settings", async (_event, partial: Partial<BrowserSettings>) => {
    if (!partial || typeof partial !== "object") {
      return loadBrowserSettings();
    }
    // 只接受合法字段，缩放钳制到 50–300%
    const next = await saveBrowserSettings({
      userAgent: typeof partial.userAgent === "string" ? partial.userAgent : undefined,
      zoomPercent:
        typeof partial.zoomPercent === "number"
          ? Math.min(300, Math.max(50, Math.round(partial.zoomPercent)))
          : undefined,
    });
    registry.applySettings(next);
    return next;
  });

  ipcMain.handle("browser:pip-enter", async (_event, scope?: string) =>
    registry.forScope(scope).enterPip(),
  );
  ipcMain.handle("browser:pip-exit", async (event, scope?: string) =>
    serviceFor(event, scope).exitPip(),
  );
  ipcMain.handle("browser:pip-hide", async (event, scope?: string) =>
    serviceFor(event, scope).hidePip(),
  );

  return registry.active();
}
