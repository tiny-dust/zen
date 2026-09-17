import { spawn } from "node:child_process";

import type { McpServerConfig, McpToolInfo } from "@zen/shared";

/**
 * 最小 stdio MCP 客户端：initialize → tools/list → tools/call。
 * 只覆盖桌面端需要的工具面；行分隔 JSON-RPC 2.0。
 */

export interface McpCallResult {
  ok: boolean;
  /** 文本内容的拼接（MCP content blocks 里的 text） */
  text: string;
  error?: string;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpStdioClient {
  private readonly config: McpServerConfig;
  private process: ReturnType<typeof spawn> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
  private buffer = "";
  private connected = false;
  private lastError: string | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
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
    if (!this.config.command) {
      throw new Error("stdio server 缺少 command");
    }
    this.process = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout?.setEncoding("utf8");
    this.process.stdout?.on("data", (chunk: string) => this.handleData(chunk));
    this.process.stderr?.setEncoding("utf8");
    this.process.stderr?.on("data", (chunk: string) => {
      // stderr 只作诊断缓存，不打日志
      this.lastError = chunk.trim().slice(0, 200) || this.lastError;
    });
    this.process.on("exit", () => {
      this.connected = false;
      this.rejectAllPending("MCP server 进程退出");
    });
    this.process.on("error", (error) => {
      this.connected = false;
      this.lastError = error.message;
      this.rejectAllPending(error.message);
    });

    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zen-desktop", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
    this.connected = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.process) {
      await this.connect();
    }
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    return (result.tools ?? []).map((tool) => ({
      serverId: this.config.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async callTool(toolName: string, args: unknown): Promise<McpCallResult> {
    if (!this.process || !this.connected) {
      await this.connect();
    }
    try {
      const result = (await this.request("tools/call", {
        name: toolName,
        arguments: args ?? {},
      })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      const text = (result.content ?? [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
      return { ok: result.isError !== true, text, error: result.isError ? text : undefined };
    } catch (error) {
      return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
    }
  }

  shutdown(): void {
    this.rejectAllPending("MCP client 关闭");
    this.process?.kill();
    this.process = null;
    this.connected = false;
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        this.handleLine(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const resolver = this.pending.get(message.id);
      if (resolver) {
        this.pending.delete(message.id);
        resolver(message);
      }
    }
    // 服务端主动通知（logging 等）当前忽略
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error(`MCP server ${this.config.name} 未运行`));
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} 超时（30s）`));
      }, 30_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(`MCP ${method}: ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.process.stdin.write(`${payload}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin) {
      return;
    }
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private rejectAllPending(reason: string): void {
    for (const [id, resolver] of this.pending) {
      resolver({ jsonrpc: "2.0", id, error: { code: -32000, message: reason } });
    }
    this.pending.clear();
  }
}
