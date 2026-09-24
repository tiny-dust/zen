import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type { ServicesAgentBridge } from "@zen/agent-core";
import type { AgentServiceInfo } from "@zen/shared";

const execFileAsync = promisify(execFile);

interface TrackedService {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  startedAt: number;
  /** 启动 shell 的 pid（detached，即进程组 id）；settle 后 shell 已死，仅作组 id 使用 */
  pgid: number;
  /** settle 检出的存活进程；list 时刷新，空数组表示尚未 settle */
  pids: number[];
}

/** 解析 `ps -axo pid=,pgid=,stat=` 输出，取指定进程组内存活（非僵尸）的 pid */
export function parseGroupPids(stdout: string, pgid: number): number[] {
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const group = Number(match[2]);
    const stat = match[3] ?? "";
    if (group === pgid && !stat.startsWith("Z")) {
      pids.push(pid);
    }
  }
  return pids;
}

/**
 * 长驻服务登记表（main 单例）：runTerminal spawn 时 track，settle 时检测进程组
 * 存活者；有则收集为长驻服务（dev server / watch 等），供右栏「服务」查看与关闭。
 * 进程组随命令自然结束则静默清除，不产生噪音。
 */
export class AgentServicesRegistry {
  private entries = new Map<number, TrackedService>();
  private broadcast: (channel: string, payload: unknown) => void = () => undefined;
  private sweepTimer: NodeJS.Timeout | null = null;

  setBroadcast(fn: (channel: string, payload: unknown) => void): void {
    this.broadcast = fn;
  }

  bridge(): ServicesAgentBridge {
    return {
      track: (request) => this.track(request),
      settle: (pid) => void this.settle(pid),
    };
  }

  track(request: { sessionId: string; command: string; cwd: string; pid: number }): void {
    if (!Number.isInteger(request.pid) || request.pid <= 0) {
      return;
    }
    this.entries.set(request.pid, {
      id: randomUUID(),
      sessionId: request.sessionId,
      command: request.command,
      cwd: request.cwd,
      startedAt: Date.now(),
      pgid: request.pid,
      pids: [],
    });
  }

  /** runTerminal 结束：进程组仍有存活者（不含已死的 shell）→ 收集为长驻服务 */
  async settle(pid: number): Promise<void> {
    const entry = this.entries.get(pid);
    if (!entry) {
      return;
    }
    const survivors = (await this.detectGroupPids(pid)).filter((item) => item !== pid);
    if (!survivors.length) {
      this.entries.delete(pid);
      return;
    }
    entry.pids = survivors;
    this.emit();
  }

  /** 刷新存活状态并返回当前长驻服务清单（只含已 settle 且仍有存活进程的条目） */
  async list(): Promise<AgentServiceInfo[]> {
    await this.refresh();
    return this.infos();
  }

  /** 关闭服务：先 SIGTERM 整个进程组，1.5s 后对残留进程 SIGKILL */
  async kill(id: string): Promise<{ ok: boolean; error?: string }> {
    const entry = Array.from(this.entries.values()).find((item) => item.id === id);
    if (!entry) {
      return { ok: false, error: "service not found" };
    }
    await this.killGroup(entry.pgid);
    this.entries.delete(entry.pgid);
    this.emit();
    return { ok: true };
  }

  /** 应用退出：清掉所有登记的进程组，避免 Zen 退出后服务继续挂着（退出不走宽限期，直接 SIGKILL） */
  async shutdown(): Promise<void> {
    this.stopSweep();
    for (const entry of this.entries.values()) {
      if (process.platform === "win32") {
        await execFileAsync("taskkill", ["/PID", String(entry.pgid), "/T", "/F"]).catch(
          () => undefined,
        );
        continue;
      }
      try {
        process.kill(-entry.pgid, "SIGKILL");
      } catch {
        // 组已不存在
      }
    }
    this.entries.clear();
  }

  private async detectGroupPids(pgid: number): Promise<number[]> {
    if (process.platform === "win32") {
      // Windows 无进程组语义：只能探测启动 shell 本身是否存活（孙进程无法枚举，尽力而为）
      try {
        process.kill(pgid, 0);
        return [pgid];
      } catch {
        return [];
      }
    }
    try {
      const { stdout } = await execFileAsync("ps", ["-axo", "pid=,pgid=,stat="]);
      return parseGroupPids(stdout, pgid);
    } catch {
      return [];
    }
  }

  private async killGroup(pgid: number): Promise<void> {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pgid), "/T", "/F"]).catch(() => undefined);
      return;
    }
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      // 组已不存在
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const { stdout } = await execFileAsync("ps", ["-axo", "pid=,pgid=,stat="]);
      const remaining = parseGroupPids(stdout, pgid);
      for (const pid of remaining) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // 已退出
        }
      }
    } catch {
      // ps 失败时组多半已消失
    }
  }

  /** 刷新各条目存活进程；无存活者 → 移除；有变化 → 推送 */
  private async refresh(): Promise<void> {
    let changed = false;
    for (const [pgid, entry] of Array.from(this.entries)) {
      if (!entry.pids.length) {
        continue;
      }
      const pids = (await this.detectGroupPids(pgid)).filter((item) => item !== pgid);
      if (pids.length) {
        if (pids.length !== entry.pids.length) {
          entry.pids = pids;
          changed = true;
        }
      } else {
        this.entries.delete(pgid);
        changed = true;
      }
    }
    if (changed) {
      this.emit();
    }
  }

  private infos(): AgentServiceInfo[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.pids.length > 0)
      .map((entry) => ({
        id: entry.id,
        sessionId: entry.sessionId,
        command: entry.command,
        cwd: entry.cwd,
        startedAt: entry.startedAt,
        pids: [...entry.pids],
      }));
  }

  private emit(): void {
    this.broadcast("services:changed", this.infos());
    if (this.entries.size > 0) {
      this.startSweep();
    } else {
      this.stopSweep();
    }
  }

  /** 服务存活期间周期清扫：服务自行退出后从面板消失 */
  private startSweep(): void {
    if (this.sweepTimer) {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.refresh();
    }, 15_000);
    this.sweepTimer.unref?.();
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

let singleton: AgentServicesRegistry | null = null;

export function initAgentServices(
  broadcast: (channel: string, payload: unknown) => void,
): AgentServicesRegistry {
  if (!singleton) {
    singleton = new AgentServicesRegistry();
  }
  singleton.setBroadcast(broadcast);
  return singleton;
}

export function getAgentServicesRegistry(): AgentServicesRegistry | null {
  return singleton;
}

export function shutdownAgentServices(): Promise<void> {
  return singleton?.shutdown() ?? Promise.resolve();
}
