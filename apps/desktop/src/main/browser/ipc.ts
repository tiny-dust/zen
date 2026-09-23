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
import { getBrowserService } from "./service";
import { loadBrowserSettings, saveBrowserSettings } from "../zen-dir";

export function registerBrowserIpc(
  broadcast: (channel: string, payload: unknown) => void,
): BrowserAgentBridge {
  const service = getBrowserService();

  // 载入 ~/.zen/config.json 的浏览器设置（UA/缩放/画中画几何），失败静默用缺省值
  void service.initSettings();

  service.onStatus((status) => {
    broadcast("browser:status", status);
  });
  service.onElementPicked((ref: BrowserElementRef) => {
    broadcast("browser:element-picked", ref);
  });

  ipcMain.handle("browser:status", (): BrowserStatus => service.getStatus());

  ipcMain.handle("browser:ensure-running", async (event): Promise<BrowserStatus> => {
    service.attachToWindow(BrowserWindow.fromWebContents(event.sender));
    return service.ensureRunning();
  });

  ipcMain.handle("browser:stop", async (): Promise<BrowserStatus> => {
    service.dispose();
    return service.getStatus();
  });

  ipcMain.handle(
    "browser:set-bounds",
    async (_event, bounds: BrowserViewBounds | null, visible?: boolean) => {
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

  ipcMain.handle("browser:set-visible", async (_event, visible: boolean) => {
    service.setVisible(Boolean(visible));
    return service.getStatus();
  });

  ipcMain.handle("browser:open", async (event, url: string): Promise<BrowserOpenResult> => {
    service.attachToWindow(BrowserWindow.fromWebContents(event.sender));
    return service.open(url);
  });

  ipcMain.handle("browser:go-back", async () => service.goBack());
  ipcMain.handle("browser:go-forward", async () => service.goForward());
  ipcMain.handle("browser:reload", async (_event, ignoreCache?: boolean) =>
    service.reload(Boolean(ignoreCache)),
  );
  ipcMain.handle("browser:open-external", async (_event, url?: string) =>
    service.openInSystemBrowser(url),
  );
  ipcMain.handle("browser:focus-host", async () => service.focusHost());
  ipcMain.handle("browser:debug", async () => service.debugInfo());

  ipcMain.handle("browser:snapshot", async (event): Promise<BrowserSnapshot> => {
    service.attachToWindow(BrowserWindow.fromWebContents(event.sender));
    return service.snapshot();
  });

  ipcMain.handle("browser:extract", async (event): Promise<BrowserExtractResult> => {
    service.attachToWindow(BrowserWindow.fromWebContents(event.sender));
    return service.extract();
  });

  ipcMain.handle(
    "browser:click",
    async (_event, selector: string): Promise<BrowserActionResult> => {
      return service.click(selector);
    },
  );

  ipcMain.handle(
    "browser:type",
    async (
      _event,
      selector: string,
      text: string,
      options?: { submit?: boolean },
    ): Promise<BrowserActionResult> => {
      return service.type(selector, text, options);
    },
  );

  ipcMain.handle("browser:console", async (_event, limit?: number) => {
    return service.console(limit);
  });

  ipcMain.handle("browser:performance", async (): Promise<BrowserPerformanceMetrics> => {
    return service.performance();
  });

  ipcMain.handle("browser:screenshot", async (): Promise<BrowserScreenshotResult> => {
    return service.screenshot();
  });

  ipcMain.handle(
    "browser:evaluate",
    async (_event, expression: string): Promise<BrowserEvalResult> => {
      return service.evaluate(expression);
    },
  );

  ipcMain.handle("browser:pick-start", async (event) => {
    service.attachToWindow(BrowserWindow.fromWebContents(event.sender));
    return service.startElementPick();
  });
  ipcMain.handle("browser:pick-stop", async () => service.stopElementPick());

  // ===== 浏览器设置（UA / 尺寸）与画中画 =====
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
    service.applyBrowserSettings(next);
    return next;
  });

  ipcMain.handle("browser:pip-enter", async () => service.enterPip());
  ipcMain.handle("browser:pip-exit", async () => service.exitPip());
  ipcMain.handle("browser:pip-hide", async () => service.hidePip());

  return service;
}
