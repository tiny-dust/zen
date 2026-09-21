import type { BrowserElementRef } from "@zen/shared";

import { withTimeout } from "./browser-utils";
import { BrowserViewManager } from "./browser-view";

/** CDP（Chrome DevTools Protocol）桥：懒挂载 debugger，收敛事件分发与命令发送。 */
export class BrowserCdpClient extends BrowserViewManager {
  /** 懒挂载 CDP，带超时；失败不阻断浏览 */
  protected async ensureDebugger(timeoutMs = 3000): Promise<boolean> {
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

  protected async sendDebugger<T>(
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
}
