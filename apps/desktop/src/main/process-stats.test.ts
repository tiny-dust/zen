import { describe, expect, it } from "vitest";

import { parsePosixProcessStats, parseWindowsProcessStats } from "./process-stats";

describe("parsePosixProcessStats", () => {
  it("解析 pid / %cpu / rss（KB → 字节），跳过无法解析的行", () => {
    const stdout = [
      "  123  2.5  102400",
      "  456  0.0  2048",
      "garbage line",
      "  0  1.0  10",
      "",
    ].join("\n");
    expect(parsePosixProcessStats(stdout)).toEqual([
      { pid: 123, cpuPercent: 2.5, rssBytes: 102_400 * 1024 },
      { pid: 456, cpuPercent: 0, rssBytes: 2048 * 1024 },
    ]);
  });

  it("空输出返回空数组", () => {
    expect(parsePosixProcessStats("")).toEqual([]);
  });
});

describe("parseWindowsProcessStats", () => {
  it("解析 PerfProc 形状（IDProcess / PercentProcessorTime / WorkingSetPrivate）", () => {
    const json = JSON.stringify([
      { IDProcess: 4321, PercentProcessorTime: 12, WorkingSetPrivate: 55_000_000 },
    ]);
    expect(parseWindowsProcessStats(json)).toEqual([
      { pid: 4321, cpuPercent: 12, rssBytes: 55_000_000 },
    ]);
  });

  it("解析 Win32_Process 回退形状：缺 CPU 记 null 而不是 0", () => {
    const json = JSON.stringify([{ ProcessId: 88, WorkingSetSize: 4096 }]);
    expect(parseWindowsProcessStats(json)).toEqual([
      { pid: 88, cpuPercent: null, rssBytes: 4096 },
    ]);
  });

  it("单对象（非数组）也能解析，并含 BOM 时仍可读", () => {
    const json = `\uFEFF${JSON.stringify({ IDProcess: 7, PercentProcessorTime: 0, WorkingSetPrivate: 1 })}`;
    expect(parseWindowsProcessStats(json)).toEqual([
      { pid: 7, cpuPercent: 0, rssBytes: 1 },
    ]);
  });

  it("非法 pid 被丢弃", () => {
    const json = JSON.stringify([{ IDProcess: 0 }, { IDProcess: null }, { IDProcess: 9 }]);
    expect(parseWindowsProcessStats(json).map((stat) => stat.pid)).toEqual([9]);
  });
});
