import { consumeSseStream, McpBaseClient } from "./base";

import type { McpServerConfig } from "@zen/shared";

const ENDPOINT_TIMEOUT_MS = 10_000;

/**
 * 远程 MCP 客户端，双协议：
 * - "http"：Streamable HTTP（2025-03-26 新版协议），POST 到 url，响应为 JSON 或 SSE 流，
 *   会话经 mcp-session-id 头维持。
 * - "sse"：HTTP+SSE（2024-11-05 旧版协议），GET url 打开 SSE 流，endpoint 事件给出上报地址，
 *   请求 POST 上报，响应经 SSE 流回传。
 */
export class McpHttpClient extends McpBaseClient {
  private connected = false;
  private lastError: string | null = null;
  /** legacy SSE：GET 流的中止器与上报地址 */
  private getAbort: AbortController | null = null;
  private postUrl: string | null = null;
  private endpointReady: (() => void) | null = null;
  /** streamable：服务器下发的会话 id */
  private sessionId: string | null = null;

  constructor(config: McpServerConfig) {
    super(config);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get error(): string | null {
    return this.lastError;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (!this.config.url) {
      throw new Error("远程 server 缺少 url");
    }
    if (this.config.transport === "sse") {
      await this.openSseStream();
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "zen-desktop", version: "0.1.0" },
      });
    } else {
      await this.request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "zen-desktop", version: "0.1.0" },
      });
    }
    this.notify("notifications/initialized", {});
    this.connected = true;
  }

  shutdown(): void {
    this.rejectAllPending("MCP client 关闭");
    this.getAbort?.abort();
    this.getAbort = null;
    this.endpointReady = null;
    this.postUrl = null;
    this.sessionId = null;
    this.connected = false;
  }

  protected sendRaw(payload: string): void {
    void this.postMessage(payload).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.rejectAllPending(message);
    });
  }

  // ---------- 旧版协议：GET SSE 流等待 endpoint 事件 ----------

  private async openSseStream(): Promise<void> {
    const controller = new AbortController();
    this.getAbort = controller;
    let response: Response;
    try {
      response = await fetch(this.config.url!, {
        headers: { ...this.config.headers, Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`MCP SSE 连接失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`MCP SSE 连接失败（HTTP ${response.status}）`);
    }
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("MCP SSE 端点事件超时（10s）"));
      }, ENDPOINT_TIMEOUT_MS);
      this.endpointReady = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    void consumeSseStream(response.body, (event, data) => this.onSseEvent(event, data)).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.connected = false;
        this.lastError = message;
        this.rejectAllPending(message);
      },
    );
    try {
      await ready;
    } catch (error) {
      controller.abort();
      this.getAbort = null;
      throw error;
    } finally {
      this.endpointReady = null;
    }
  }

  // ---------- 入站分发 ----------

  private onSseEvent(event: string, data: string): void {
    if (event === "endpoint") {
      // 旧协议：上报地址可能是相对路径
      try {
        this.postUrl = new URL(data, this.config.url ?? undefined).toString();
      } catch {
        this.postUrl = data;
      }
      this.endpointReady?.();
      this.endpointReady = null;
      return;
    }
    this.dispatchData(data);
  }

  private dispatchData(data: string): void {
    const trimmed = data.trim();
    if (!trimmed) {
      return;
    }
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    this.handleResponse(message);
  }

  // ---------- 出站 ----------

  private async postMessage(payload: string): Promise<void> {
    if (this.config.transport === "sse") {
      await this.postLegacy(payload);
    } else {
      await this.postStreamable(payload);
    }
  }

  /** 旧版协议：POST 到 endpoint 事件给出的地址，响应统一走 SSE 通道 */
  private async postLegacy(payload: string): Promise<void> {
    if (!this.postUrl) {
      throw new Error("MCP SSE 上报地址未就绪");
    }
    const response = await fetch(this.postUrl, {
      method: "POST",
      headers: { ...this.config.headers, "Content-Type": "application/json" },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}`);
    }
    // 个别实现直接在 POST 响应里回 JSON，做兼容分发；其余响应体（202 等）直接丢弃
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await response.text();
      this.dispatchData(text);
    } else {
      void response.body?.cancel().catch(() => undefined);
    }
  }

  /** 新版协议：POST 到服务地址，响应为 JSON 或 SSE 流；记录会话 id */
  private async postStreamable(payload: string): Promise<void> {
    const headers: Record<string, string> = {
      ...this.config.headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["MCP-Session-Id"] = this.sessionId;
    }
    const response = await fetch(this.config.url!, { method: "POST", headers, body: payload });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MCP HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && response.body) {
      await consumeSseStream(response.body, (event, data) => {
        if (!event || event === "message") {
          this.dispatchData(data);
        }
      });
    } else if (contentType.includes("application/json")) {
      const text = await response.text();
      this.dispatchData(text);
    }
    // 202 / 空响应：通知类，无需处理
  }
}
