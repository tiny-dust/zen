import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import type { IPty } from "node-pty";
import * as pty from "node-pty";

import { resolveDefaultShell } from "@zen/tools-terminal";

import type {
  PtyDataEvent,
  PtyExitEvent,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
} from "@zen/shared";

interface SessionRecord {
  id: string;
  pty: IPty;
  cwd: string;
  shell: string;
}

type DataListener = (event: PtyDataEvent) => void;
type ExitListener = (event: PtyExitEvent) => void;

export class TerminalService {
  private sessions = new Map<string, SessionRecord>();
  private dataListeners = new Set<DataListener>();
  private exitListeners = new Set<ExitListener>();

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  defaultShell(): TerminalShellInfo {
    return resolveDefaultShell();
  }

  list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map((item) => ({
      id: item.id,
      shell: item.shell,
      cwd: item.cwd,
      pid: item.pty.pid,
      cols: item.pty.cols,
      rows: item.pty.rows,
    }));
  }

  create(options?: { cwd?: string; cols?: number; rows?: number; shell?: string }): TerminalCreateResult {
    try {
      const shellInfo = resolveDefaultShell();
      const shellPath = options?.shell?.trim() || shellInfo.path;
      const args = options?.shell?.trim() ? [] : shellInfo.args;
      const cwd = options?.cwd?.trim() || homedir();
      const cols = options?.cols && options.cols > 0 ? options.cols : 80;
      const rows = options?.rows && options.rows > 0 ? options.rows : 24;
      const id = randomUUID();

      const term = pty.spawn(shellPath, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>,
      });

      const record: SessionRecord = { id, pty: term, cwd, shell: shellPath };
      this.sessions.set(id, record);

      term.onData((data) => {
        for (const listener of this.dataListeners) {
          listener({ sessionId: id, data });
        }
      });
      term.onExit(({ exitCode }) => {
        this.sessions.delete(id);
        for (const listener of this.exitListeners) {
          listener({ sessionId: id, exitCode });
        }
      });

      return {
        ok: true,
        session: {
          id,
          shell: shellPath,
          cwd,
          pid: term.pid,
          cols,
          rows,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "启动终端失败",
      };
    }
  }

  write(sessionId: string, data: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return false;
    }
    record.pty.write(data);
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || cols <= 0 || rows <= 0) {
      return false;
    }
    record.pty.resize(cols, rows);
    return true;
  }

  kill(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return false;
    }
    try {
      record.pty.kill();
    } catch {
      // already dead
    }
    this.sessions.delete(sessionId);
    return true;
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.kill(id);
    }
  }

  /** 在系统默认终端 App 中打开工作区（展示优先走系统终端） */
  openExternal(cwd: string): { ok: boolean; opener?: string; error?: string } {
    const dir = cwd || homedir();
    if (process.platform === "darwin") {
      const child = spawn("open", ["-a", "Terminal", dir], { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, opener: "Terminal.app" };
    }
    if (process.platform === "win32") {
      const child = spawn("cmd.exe", ["/c", "start", "cmd.exe", "/K", `cd /d ${dir}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { ok: true, opener: "cmd.exe" };
    }
    const candidates = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
    for (const opener of candidates) {
      try {
        const child = spawn(opener, ["--working-directory", dir], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return { ok: true, opener };
      } catch {
        // try next
      }
    }
    return { ok: false, error: "未找到可用的系统终端" };
  }
}

let singleton: TerminalService | null = null;

export function getTerminalService(): TerminalService {
  if (!singleton) {
    singleton = new TerminalService();
  }
  return singleton;
}

export function shutdownTerminalService(): void {
  singleton?.killAll();
  singleton = null;
}
