import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { McpBaseClient } from "./base";

import type { McpServerConfig } from "@zen/shared";

/** GUI 启动时补找包管理器与 Node，避免桌面环境 PATH 缺失。 */
async function resolvePackageManagerInvocation(command: "npx" | "pnpm", env: NodeJS.ProcessEnv): Promise<{
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} | null> {
  const isWin = process.platform === "win32";
  const pathDirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extraDirs = isWin
    ? [
        command === "pnpm" ? (env.PNPM_HOME ?? "") : "",
        env.APPDATA ? join(env.APPDATA, "npm") : "",
        env.ProgramFiles ? join(env.ProgramFiles, "nodejs") : "",
        join(homedir(), ".volta", "bin"),
        join(homedir(), "scoop", "apps", "nodejs", "current"),
      ].filter(Boolean)
    : [
        ...(command === "pnpm"
          ? [
              env.PNPM_HOME ?? "",
              join(homedir(), ".local", "share", "pnpm"),
              join(homedir(), ".vite-plus", "bin"),
            ]
          : []),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join(homedir(), "n", "bin"),
        join(homedir(), ".volta", "bin"),
        join(homedir(), ".local", "bin"),
        join(homedir(), ".asdf", "shims"),
      ];
  if (!isWin) {
    try {
      const root = join(homedir(), ".nvm", "versions", "node");
      const versions = await readdir(root);
      const latest = versions
        .filter((name) => /^v?\d+(\.\d+)*$/.test(name))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .at(-1);
      if (latest) extraDirs.push(join(root, latest, "bin"));
    } catch {
      // 未安装 nvm
    }
  }

  const dirs = [...extraDirs, ...pathDirs].filter(Boolean);
  async function find(name: string): Promise<string | null> {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        // 尝试下一个安装目录
      }
    }
    return null;
  }

  // Windows 的独立 pnpm.exe 可直接执行；.cmd 则需经 Node 启动 CLI，避免 shell 解释参数。
  if (isWin && command === "pnpm") {
    const executable = await find("pnpm.exe");
    if (executable) {
      return {
        command: executable,
        args: [],
        env: { ...env, PATH: [dirname(executable), ...pathDirs].join(delimiter) },
      };
    }
  }
  const executable = await find(isWin ? `${command}.cmd` : command);
  const node = await find(isWin ? "node.exe" : "node");
  if (!executable || !node) return null;
  const nodeDir = dirname(node);
  if (isWin) {
    const cliPaths = command === "npx"
      ? ["node_modules/npm/bin/npx-cli.js"]
      : ["node_modules/pnpm/bin/pnpm.cjs", "node_modules/corepack/dist/pnpm.js"];
    for (const dir of [dirname(executable), nodeDir]) {
      for (const path of cliPaths) {
        const cli = join(dir, path);
        try {
          if ((await stat(cli)).isFile()) {
            return { command: node, args: [cli], env: { ...env, PATH: [nodeDir, ...pathDirs].join(delimiter) } };
          }
        } catch {
          // 尝试下一处 CLI 安装位置
        }
      }
    }
    return null;
  }
  return { command: executable, args: [], env: { ...env, PATH: [nodeDir, ...pathDirs].join(delimiter) } };
}

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

  get requiresAuth(): boolean {
    return false;
  }

  get authChallenge(): string | null {
    return null;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (!this.config.command) {
      throw new Error("stdio server 缺少 command");
    }
    const env = { ...process.env, ...this.config.env };
    const command = this.config.command;
    const invocation = command === "npx" || command === "pnpm"
      ? await resolvePackageManagerInvocation(command, env)
      : null;
    this.process = spawn(invocation?.command ?? command, [
      ...(invocation?.args ?? []),
      ...(this.config.args ?? []).map((arg) =>
        (command === "npx" || command === "pnpm") && /^~[/\\]/.test(arg) ? join(homedir(), arg.slice(2)) : arg,
      ),
    ], {
      env: invocation?.env ?? env,
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
