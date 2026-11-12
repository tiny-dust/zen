import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { promisify } from "node:util";

import type { IPty } from "@lydell/node-pty";
import * as pty from "@lydell/node-pty";

import { resolveDefaultShell } from "@zen/tools-terminal";

import type {
  PtyDataEvent,
  PtyExitEvent,
  TerminalActivity,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
} from "@zen/shared";

interface ProcessEntry {
  pid: number;
  ppid: number;
  command: string;
  zombie?: boolean;
}

/** Shell 本身不算活动；只认进程表中仍存活的后代。 */
export function findLiveDescendant(shellPid: number, processes: ProcessEntry[]): ProcessEntry | undefined {
  if (!processes.some((item) => item.pid === shellPid && !item.zombie)) return undefined;
  const children = new Map<number, ProcessEntry[]>();
  for (const item of processes) {
    if (item.zombie || item.pid === shellPid) continue;
    const siblings = children.get(item.ppid) ?? [];
    siblings.push(item);
    children.set(item.ppid, siblings);
  }
  const visited = new Set([shellPid]);
  const queue = [shellPid];
  let descendant: ProcessEntry | undefined;
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]!) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      queue.push(child.pid);
      descendant = child;
    }
  }
  return descendant;
}

export function parsePosixProcesses(output: string): ProcessEntry[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), zombie: match[3]!.startsWith("Z"), command: match[4]! }] : [];
  });
}

export function parseWindowsProcesses(output: string): ProcessEntry[] {
  const value: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
  if (!Array.isArray(value)) throw new Error("Invalid CIM process list");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("ProcessId" in item) || !("ParentProcessId" in item) || !("Name" in item)
      || typeof item.ProcessId !== "number" || typeof item.ParentProcessId !== "number" || typeof item.Name !== "string") {
      throw new Error("Invalid CIM process entry");
    }
    return { pid: item.ProcessId, ppid: item.ParentProcessId, command: item.Name };
  });
}

const execFileAsync = promisify(execFile);

async function listProcesses(): Promise<ProcessEntry[]> {
  const options = { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  if (process.platform === "win32") {
    // Windows: CIM exposes the real parent PID (unlike tasklist).
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name) -Compress"], options);
    return parseWindowsProcesses(stdout);
  }
  // macOS / Linux: stat filters defunct descendants; comm is the executable name.
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,stat=,comm="], options);
  return parsePosixProcesses(stdout);
}

interface SessionRecord {
  id: string;
  pty: IPty;
  cwd: string;
  shell: string;
  ownerSessionId: string | null;
  activity: TerminalActivity;
}

type DataListener = (event: PtyDataEvent) => void;
type ExitListener = (event: PtyExitEvent) => void;
type ActivityListener = (event: TerminalActivity) => void;

export class TerminalService {
  private sessions = new Map<string, SessionRecord>();
  private dataListeners = new Set<DataListener>();
  private exitListeners = new Set<ExitListener>();
  private activityListeners = new Set<ActivityListener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  onActivity(listener: ActivityListener): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  listActivities(): TerminalActivity[] {
    return Array.from(this.sessions.values(), (record) => ({ ...record.activity }));
  }

  private emitActivity(record: SessionRecord, active: boolean, command?: string, force = false): void {
    const next: TerminalActivity = { terminalId: record.id, ownerSessionId: record.ownerSessionId, active };
    if (active && command) next.command = command;
    const previous = record.activity;
    if (!force && previous.active === next.active && previous.command === next.command && previous.ownerSessionId === next.ownerSessionId) return;
    record.activity = next;
    for (const listener of this.activityListeners) listener(next);
  }

  private stopPollingIfEmpty(): void {
    if (this.sessions.size || !this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollActivities(): Promise<void> {
    if (this.polling || !this.sessions.size) return;
    this.polling = true;
    try {
      const processes = await listProcesses();
      for (const record of this.sessions.values()) {
        const descendant = findLiveDescendant(record.pty.pid, processes);
        this.emitActivity(record, Boolean(descendant), descendant?.command);
      }
    } catch (error) {
      // A failed OS scan cannot establish that a command is still running.
      console.warn("Failed to inspect PTY descendants", error);
      for (const record of this.sessions.values()) this.emitActivity(record, false);
    } finally {
      this.polling = false;
    }
  }

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

  create(options?: { cwd?: string; cols?: number; rows?: number; shell?: string; ownerSessionId?: string }): TerminalCreateResult {
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

      const ownerSessionId = options?.ownerSessionId?.trim() || null;
      const record: SessionRecord = {
        id, pty: term, cwd, shell: shellPath, ownerSessionId,
        activity: { terminalId: id, ownerSessionId, active: false },
      };
      this.sessions.set(id, record);

      term.onData((data) => {
        for (const listener of this.dataListeners) {
          listener({ sessionId: id, data });
        }
      });
      term.onExit(({ exitCode }) => {
        if (this.sessions.get(id) !== record) return;
        this.emitActivity(record, false, undefined, true);
        this.sessions.delete(id);
        this.stopPollingIfEmpty();
        for (const listener of this.exitListeners) {
          listener({ sessionId: id, exitCode });
        }
      });
      if (!this.pollTimer) {
        this.pollTimer = setInterval(() => { void this.pollActivities(); }, 1500);
        this.pollTimer.unref();
      }
      void this.pollActivities();

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

  write(sessionId: string, data: string, ownerSessionId?: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    record.pty.write(data);
    // Only a submitted line may change ownership; typing or stdin for a running process must not.
    if (!record.activity.active && /[\r\n]/.test(data) && ownerSessionId?.trim()) {
      record.ownerSessionId = ownerSessionId.trim();
      this.emitActivity(record, false);
    }
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
    this.emitActivity(record, false, undefined, true);
    this.sessions.delete(sessionId);
    this.stopPollingIfEmpty();
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
