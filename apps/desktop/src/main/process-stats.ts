import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProcessStat } from "@zen/shared";

const execFileAsync = promisify(execFile);

/** 单次采样 pid 上限：防一次调用拉起超大 ps / CIM 输出 */
const MAX_PIDS = 32;

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** 解析 `ps -axo pid=,%cpu=,rss=`（rss 单位 KB，macOS 与 Linux 一致） */
export function parsePosixProcessStats(stdout: string): ProcessStat[] {
  const stats: ProcessStat[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      continue;
    }
    const cpu = toNumber(match[2]);
    const rssKb = toNumber(match[3]);
    stats.push({ pid, cpuPercent: cpu, rssBytes: rssKb == null ? null : rssKb * 1024 });
  }
  return stats;
}

/** 解析 CIM JSON（PerfProc 或 Win32_Process 两种形状，缺字段记 null） */
export function parseWindowsProcessStats(stdout: string): ProcessStat[] {
  const parsed: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const stats: ProcessStat[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const item = row as Record<string, unknown>;
    const pid = toNumber(item.IDProcess ?? item.ProcessId);
    if (pid == null || !Number.isSafeInteger(pid) || pid <= 0) {
      continue;
    }
    stats.push({
      pid,
      cpuPercent: toNumber(item.PercentProcessorTime),
      rssBytes: toNumber(item.WorkingSetPrivate ?? item.WorkingSetSize ?? item.WorkingSet),
    });
  }
  return stats;
}

function pick(stats: ProcessStat[], wanted: number[]): ProcessStat[] {
  const set = new Set(wanted);
  return stats.filter((stat) => set.has(stat.pid));
}

async function readWindowsStats(wanted: number[]): Promise<ProcessStat[]> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "ConvertTo-Json -InputObject @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess,PercentProcessorTime,WorkingSetPrivate) -Compress",
      ],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return pick(parseWindowsProcessStats(stdout), wanted);
  } catch {
    // PerfProc 计数类在老系统/被禁用时不可用：退回静态工作集（CPU 记 null）
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,WorkingSetSize) -Compress",
      ],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return pick(parseWindowsProcessStats(stdout), wanted);
  }
}

/**
 * 读取指定进程的真实指标。读不到（进程已退出、命令不可用）时返回空数组，
 * 由 UI 明确显示「不可用」，绝不用 0 冒充。
 * 注意：POSIX 的 %cpu 是进程生命周期均值，不是瞬时值。
 */
export async function readProcessStats(pids: number[]): Promise<ProcessStat[]> {
  const wanted = [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))].slice(0, MAX_PIDS);
  if (!wanted.length) {
    return [];
  }
  try {
    if (process.platform === "win32") {
      return await readWindowsStats(wanted);
    }
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,%cpu=,rss="], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return pick(parsePosixProcessStats(stdout), wanted);
  } catch {
    return [];
  }
}
