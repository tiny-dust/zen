import { ipcRenderer } from "electron";

import type {
  BrowserActionResult,
  BrowserConsoleEntry,
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

export const browserApi = {
  browser: {
    status(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:status");
    },
    ensureRunning(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:ensure-running");
    },
    stop(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:stop");
    },
    setBounds(bounds: BrowserViewBounds | null, visible?: boolean): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:set-bounds", bounds, visible);
    },
    setVisible(visible: boolean): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:set-visible", visible);
    },
    open(url: string): Promise<BrowserOpenResult> {
      return ipcRenderer.invoke("browser:open", url);
    },
    goBack(): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:go-back");
    },
    goForward(): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:go-forward");
    },
    reload(ignoreCache?: boolean): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:reload", ignoreCache);
    },
    openExternal(url?: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("browser:open-external", url);
    },
    focusHost(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("browser:focus-host");
    },
    debug(): Promise<Record<string, unknown>> {
      return ipcRenderer.invoke("browser:debug");
    },
    snapshot(): Promise<BrowserSnapshot> {
      return ipcRenderer.invoke("browser:snapshot");
    },
    extract(): Promise<BrowserExtractResult> {
      return ipcRenderer.invoke("browser:extract");
    },
    click(selector: string): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:click", selector);
    },
    type(
      selector: string,
      text: string,
      options?: { submit?: boolean },
    ): Promise<BrowserActionResult> {
      return ipcRenderer.invoke("browser:type", selector, text, options);
    },
    console(limit?: number): Promise<{ entries: BrowserConsoleEntry[] }> {
      return ipcRenderer.invoke("browser:console", limit);
    },
    performance(): Promise<BrowserPerformanceMetrics> {
      return ipcRenderer.invoke("browser:performance");
    },
    screenshot(): Promise<BrowserScreenshotResult> {
      return ipcRenderer.invoke("browser:screenshot");
    },
    evaluate(expression: string): Promise<BrowserEvalResult> {
      return ipcRenderer.invoke("browser:evaluate", expression);
    },
    pickStart(): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("browser:pick-start");
    },
    pickStop(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("browser:pick-stop");
    },
    getSettings(): Promise<BrowserSettings> {
      return ipcRenderer.invoke("browser:get-settings");
    },
    setSettings(partial: Partial<BrowserSettings>): Promise<BrowserSettings> {
      return ipcRenderer.invoke("browser:set-settings", partial);
    },
    pipEnter(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-enter");
    },
    pipExit(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-exit");
    },
    pipHide(): Promise<BrowserStatus> {
      return ipcRenderer.invoke("browser:pip-hide");
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
  },
};
