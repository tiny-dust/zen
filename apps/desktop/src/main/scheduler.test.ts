// 定时任务调度纯函数：每日 HH:mm 解析与到期判断（scheduler-core.ts，无 electron/DB 依赖）。
import { describe, expect, it } from "vitest";

import { isTaskDue, isValidSchedule, parseDailyTime } from "./scheduler-core";

import type { ScheduledTask } from "@zen/shared";

/** 构造任务（interval/daily 通用；enabled 由调用方控制，isTaskDue 不看它） */
function task(patch: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "t1",
    name: "test",
    prompt: "do something",
    schedule: { kind: "interval", intervalMinutes: 30 },
    enabled: true,
    workspacePath: null,
    lastRunAt: null,
    lastResult: null,
    lastRunOk: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

/** 本地时区某天某时刻的时间戳 */
function at(year: number, month: number, day: number, hours: number, minutes: number): number {
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

describe("parseDailyTime", () => {
  it("解析合法 HH:mm / H:m", () => {
    expect(parseDailyTime("08:30")).toEqual({ hours: 8, minutes: 30 });
    expect(parseDailyTime("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseDailyTime("0:0")).toEqual({ hours: 0, minutes: 0 });
    expect(parseDailyTime("  9:05 ")).toEqual({ hours: 9, minutes: 5 });
  });

  it("拒绝越界与格式非法输入", () => {
    expect(parseDailyTime("24:00")).toBeNull();
    expect(parseDailyTime("12:60")).toBeNull();
    expect(parseDailyTime("830")).toBeNull();
    expect(parseDailyTime("08:3o")).toBeNull();
    expect(parseDailyTime("")).toBeNull();
    expect(parseDailyTime(undefined)).toBeNull();
    expect(parseDailyTime(null)).toBeNull();
  });
});

describe("isValidSchedule", () => {
  it("interval 需为 >=1 的整数分钟", () => {
    expect(isValidSchedule({ kind: "interval", intervalMinutes: 1 })).toBe(true);
    expect(isValidSchedule({ kind: "interval", intervalMinutes: 1440 })).toBe(true);
    expect(isValidSchedule({ kind: "interval", intervalMinutes: 0 })).toBe(false);
    expect(isValidSchedule({ kind: "interval", intervalMinutes: -5 })).toBe(false);
    expect(isValidSchedule({ kind: "interval", intervalMinutes: 1.5 })).toBe(false);
    expect(isValidSchedule({ kind: "interval" })).toBe(false);
  });

  it("daily 需带合法 HH:mm；rrule 只是扩展位不影响校验", () => {
    expect(isValidSchedule({ kind: "daily", dailyTime: "08:30" })).toBe(true);
    expect(isValidSchedule({ kind: "daily", dailyTime: "99:00" })).toBe(false);
    expect(isValidSchedule({ kind: "daily" })).toBe(false);
    expect(isValidSchedule(undefined)).toBe(false);
  });
});

describe("isTaskDue（interval）", () => {
  it("距上次运行满 N 分钟到期；未满与边界（差 1ms）不到期", () => {
    const base = 1_000_000;
    const t = task({ createdAt: base, lastRunAt: base });
    expect(isTaskDue(t, base + 30 * 60_000)).toBe(true);
    expect(isTaskDue(t, base + 30 * 60_000 - 1)).toBe(false);
  });

  it("从未运行时以 createdAt 起算", () => {
    const t = task({ createdAt: 500, lastRunAt: null });
    expect(isTaskDue(t, 500 + 29 * 60_000)).toBe(false);
    expect(isTaskDue(t, 500 + 30 * 60_000)).toBe(true);
  });

  it("intervalMinutes 非法（0/小数）永不到期", () => {
    expect(isTaskDue(task({ schedule: { kind: "interval", intervalMinutes: 0 } }), 9e15)).toBe(false);
    expect(
      isTaskDue(task({ schedule: { kind: "interval", intervalMinutes: 1.5 } }), 9e15),
    ).toBe(false);
  });
});

describe("isTaskDue（daily）", () => {
  it("今天未到 HH:mm 不到期；到点且从未运行则到期", () => {
    const t = task({ schedule: { kind: "daily", dailyTime: "08:30" }, createdAt: at(2026, 10, 13, 6, 0) });
    expect(isTaskDue(t, at(2026, 10, 13, 8, 29))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 8, 30))).toBe(true);
  });

  it("今天已跑过（lastRunAt >= 今日 HH:mm）不再重复触发", () => {
    const t = task({
      schedule: { kind: "daily", dailyTime: "08:30" },
      lastRunAt: at(2026, 10, 13, 8, 30),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 12, 0))).toBe(false);
    // 次日到点再次到期
    expect(isTaskDue(t, at(2026, 10, 14, 8, 30))).toBe(true);
  });

  it("应用关机错过时刻，次日启动补跑一次（lastRunAt 在昨日）", () => {
    const t = task({
      schedule: { kind: "daily", dailyTime: "08:30" },
      lastRunAt: at(2026, 10, 12, 8, 31),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 9, 0))).toBe(true);
  });

  it("dailyTime 非法永不到期", () => {
    const t = task({ schedule: { kind: "daily", dailyTime: "25:00" } });
    expect(isTaskDue(t, at(2026, 10, 13, 23, 59))).toBe(false);
  });

  it("未知调度 kind 永不到期", () => {
    const t = task({ schedule: { kind: "rrule" } as unknown as ScheduledTask["schedule"] });
    expect(isTaskDue(t, 9e15)).toBe(false);
  });
});
