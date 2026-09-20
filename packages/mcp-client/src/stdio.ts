import { spawn } from "node:child_process";

import { McpBaseClient } from "./base";

import type { McpServerConfig } from "@zen/shared";

/** 本地 stdio 传输：行分隔 JSON-RPC 2.0 走 stdin/stdout */
export class McpStdioClient extends McpBaseClient {
  private process: ReturnType<typeof spawn> | null = null;
  private buffer = "";
  private connected = false;
  private lastError: string | null = null;

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

  shutdown(): void {
    this.rejectAllPending("MCP client 关闭");
    this.process?.kill();
    this.process = null;
    this.connected = false;
  }

  protected sendRaw(payload: string): void {
    if (!this.process?.stdin) {
      throw new Error(`MCP server ${this.config.name} 未运行`);
    }
    this.process.stdin.write(`${payload}\n`);
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
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    this.handleResponse(message);
  }
}
