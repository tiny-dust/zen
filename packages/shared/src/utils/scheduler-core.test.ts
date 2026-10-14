// 定时任务调度纯函数：时刻/日期解析、各类调度的校验、到期判断、日历匹配与下次运行预览（无 electron/DB 依赖）。
import { describe, expect, it } from "vitest";

import {
  isTaskDue,
  isValidSchedule,
  localDateISO,
  matchesDate,
  nextOccurrences,
  parseLocalDate,
  parseTimeOfDay,
} from "./scheduler-core";

import type { ScheduledTask, ScheduledTaskSchedule } from "../types";

/** 构造任务（五类调度通用；enabled 由调用方控制，isTaskDue 不看它） */
function task(patch: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "t1",
    name: "test",
    prompt: "do something",
    schedule: { kind: "interval", every: 30, unit: "minute" },
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

describe("parseTimeOfDay", () => {
  it("解析合法 HH:mm / H:m", () => {
    expect(parseTimeOfDay("08:30")).toEqual({ hours: 8, minutes: 30 });
    expect(parseTimeOfDay("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseTimeOfDay("0:0")).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeOfDay("  9:05 ")).toEqual({ hours: 9, minutes: 5 });
  });

  it("拒绝越界与格式非法输入", () => {
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("830")).toBeNull();
    expect(parseTimeOfDay("08:3o")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
  });
});

describe("isValidSchedule", () => {
  it("interval 需 every >=1 整数 + 合法单位", () => {
    expect(isValidSchedule({ kind: "interval", every: 1, unit: "second" })).toBe(true);
    expect(isValidSchedule({ kind: "interval", every: 1440, unit: "minute" })).toBe(true);
    expect(isValidSchedule({ kind: "interval", every: 3, unit: "month" })).toBe(true);
    expect(isValidSchedule({ kind: "interval", every: 0, unit: "minute" })).toBe(false);
    expect(isValidSchedule({ kind: "interval", every: -5, unit: "hour" })).toBe(false);
    expect(isValidSchedule({ kind: "interval", every: 1.5, unit: "day" })).toBe(false);
    expect(isValidSchedule({ kind: "interval", every: 10 })).toBe(false);
    expect(isValidSchedule({ kind: "interval", every: 10, unit: "week" as never })).toBe(false);
    expect(isValidSchedule({ kind: "interval" })).toBe(false);
  });

  it("daily 需带合法 HH:mm", () => {
    expect(isValidSchedule({ kind: "daily", time: "08:30" })).toBe(true);
    expect(isValidSchedule({ kind: "daily", time: "99:00" })).toBe(false);
    expect(isValidSchedule({ kind: "daily" })).toBe(false);
    expect(isValidSchedule(undefined)).toBe(false);
  });

  it("monthly 需 1-31 的几号 + 合法时刻", () => {
    expect(isValidSchedule({ kind: "monthly", day: 1, time: "08:30" })).toBe(true);
    expect(isValidSchedule({ kind: "monthly", day: 31, time: "23:59" })).toBe(true);
    expect(isValidSchedule({ kind: "monthly", day: 0, time: "08:30" })).toBe(false);
    expect(isValidSchedule({ kind: "monthly", day: 32, time: "08:30" })).toBe(false);
    expect(isValidSchedule({ kind: "monthly", day: 15, time: "25:00" })).toBe(false);
    expect(isValidSchedule({ kind: "monthly", day: 15 })).toBe(false);
  });

  it("once 需正整数时间戳", () => {
    expect(isValidSchedule({ kind: "once", at: at(2026, 10, 14, 9, 0) })).toBe(true);
    expect(isValidSchedule({ kind: "once", at: 0 })).toBe(false);
    expect(isValidSchedule({ kind: "once", at: -1 })).toBe(false);
    expect(isValidSchedule({ kind: "once" })).toBe(false);
  });

  it("window 需起止合法、起点早于终点、间隔分钟 >=1", () => {
    expect(
      isValidSchedule({ kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 30 }),
    ).toBe(true);
    // 起点晚于终点（含相等）不支持跨零点
    expect(
      isValidSchedule({ kind: "window", startTime: "18:00", endTime: "09:00", everyMinutes: 30 }),
    ).toBe(false);
    expect(
      isValidSchedule({ kind: "window", startTime: "09:00", endTime: "09:00", everyMinutes: 30 }),
    ).toBe(false);
    expect(
      isValidSchedule({ kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 0 }),
    ).toBe(false);
    expect(isValidSchedule({ kind: "window", startTime: "09:00", endTime: "18:00" })).toBe(false);
    expect(isValidSchedule({ kind: "window", endTime: "18:00", everyMinutes: 30 })).toBe(false);
  });
});

describe("isTaskDue（interval）", () => {
  it("秒级：距上次运行满 N 秒到期；差 1ms 不到期", () => {
    const base = 1_000_000;
    const t = task({
      schedule: { kind: "interval", every: 30, unit: "second" },
      createdAt: base,
      lastRunAt: base,
    });
    expect(isTaskDue(t, base + 30_000)).toBe(true);
    expect(isTaskDue(t, base + 30_000 - 1)).toBe(false);
  });

  it("分/时/天单位按对应毫秒数到期；从未运行时以 createdAt 起算", () => {
    const minute = task({
      schedule: { kind: "interval", every: 5, unit: "minute" },
      createdAt: 500,
      lastRunAt: null,
    });
    expect(isTaskDue(minute, 500 + 5 * 60_000 - 1)).toBe(false);
    expect(isTaskDue(minute, 500 + 5 * 60_000)).toBe(true);

    const hour = task({
      schedule: { kind: "interval", every: 2, unit: "hour" },
      createdAt: 0,
      lastRunAt: 0,
    });
    expect(isTaskDue(hour, 2 * 3_600_000 - 1)).toBe(false);
    expect(isTaskDue(hour, 2 * 3_600_000)).toBe(true);

    const day = task({
      schedule: { kind: "interval", every: 1, unit: "day" },
      createdAt: 0,
      lastRunAt: 0,
    });
    expect(isTaskDue(day, 86_400_000 - 1)).toBe(false);
    expect(isTaskDue(day, 86_400_000)).toBe(true);
  });

  it("月单位按日历月推进（1/31 + 1 月 = 2/28）", () => {
    const base = at(2026, 1, 31, 9, 0);
    const t = task({
      schedule: { kind: "interval", every: 1, unit: "month" },
      createdAt: base,
      lastRunAt: base,
    });
    expect(isTaskDue(t, at(2026, 2, 27, 23, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 2, 28, 9, 0))).toBe(true);
  });

  it("every/unit 非法（0/小数/缺单位）永不到期", () => {
    expect(
      isTaskDue(task({ schedule: { kind: "interval", every: 0, unit: "minute" } }), 9e15),
    ).toBe(false);
    expect(
      isTaskDue(task({ schedule: { kind: "interval", every: 1.5, unit: "minute" } }), 9e15),
    ).toBe(false);
    expect(
      isTaskDue(task({ schedule: { kind: "interval", every: 5 } as ScheduledTaskSchedule }), 9e15),
    ).toBe(false);
  });
});

describe("isTaskDue（daily）", () => {
  it("今天未到 HH:mm 不到期；到点且从未运行则到期", () => {
    const t = task({ schedule: { kind: "daily", time: "08:30" }, createdAt: at(2026, 10, 13, 6, 0) });
    expect(isTaskDue(t, at(2026, 10, 13, 8, 29))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 8, 30))).toBe(true);
  });

  it("今天已跑过（lastRunAt >= 今日 HH:mm）不再重复触发；次日到点再次到期", () => {
    const t = task({
      schedule: { kind: "daily", time: "08:30" },
      lastRunAt: at(2026, 10, 13, 8, 30),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 12, 0))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 14, 8, 30))).toBe(true);
  });

  it("应用关机错过时刻，次日启动补跑一次（lastRunAt 在昨日）", () => {
    const t = task({
      schedule: { kind: "daily", time: "08:30" },
      lastRunAt: at(2026, 10, 12, 8, 31),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 9, 0))).toBe(true);
  });

  it("time 非法永不到期", () => {
    const t = task({ schedule: { kind: "daily", time: "25:00" } });
    expect(isTaskDue(t, at(2026, 10, 13, 23, 59))).toBe(false);
  });
});

describe("isTaskDue（monthly）", () => {
  it("本月已过 day 日 HH:mm 且从未运行则到期；未到不到期", () => {
    const t = task({
      schedule: { kind: "monthly", day: 15, time: "09:00" },
      createdAt: at(2026, 10, 1, 0, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 15, 8, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 15, 9, 0))).toBe(true);
  });

  it("本月已跑过不再重复；下月同一时刻再次到期", () => {
    const t = task({
      schedule: { kind: "monthly", day: 15, time: "09:00" },
      lastRunAt: at(2026, 10, 15, 9, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 20, 9, 0))).toBe(false);
    expect(isTaskDue(t, at(2026, 11, 15, 9, 0))).toBe(true);
  });

  it("31 日收敛到当月最后一天（2 月 = 28 日）", () => {
    const t = task({
      schedule: { kind: "monthly", day: 31, time: "09:00" },
      createdAt: at(2026, 2, 1, 0, 0),
    });
    expect(isTaskDue(t, at(2026, 2, 27, 23, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 2, 28, 9, 0))).toBe(true);
  });
});

describe("isTaskDue（once）", () => {
  it("到点且从未运行则到期；跑过一次后（lastRunAt 落库）永不再触发", () => {
    const t = task({ schedule: { kind: "once", at: at(2026, 10, 14, 9, 0) } });
    expect(isTaskDue(t, at(2026, 10, 14, 8, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 14, 9, 0))).toBe(true);
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 14, 9, 0) }, at(2026, 10, 14, 9, 5))).toBe(
      false,
    );
  });

  it("at 非法永不到期", () => {
    expect(isTaskDue(task({ schedule: { kind: "once" } }), 9e15)).toBe(false);
    expect(isTaskDue(task({ schedule: { kind: "once", at: 0 } }), 9e15)).toBe(false);
  });
});

describe("isTaskDue（window）", () => {
  const window = { kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 60 } as const;

  it("窗口外（早于 start / 晚于 end）不到期；首次进入窗口立即到期", () => {
    const t = task({ schedule: { ...window }, createdAt: at(2026, 10, 13, 8, 0) });
    expect(isTaskDue(t, at(2026, 10, 13, 8, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 9, 0))).toBe(true);
    // 窗口结束时刻（含端点）仍可触发
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 13, 10, 0) }, at(2026, 10, 13, 18, 0))).toBe(
      true,
    );
  });

  it("窗口内距上次运行满 everyMinutes 再次到期；未满不到期", () => {
    const t = task({
      schedule: { ...window },
      lastRunAt: at(2026, 10, 13, 9, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 9, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 10, 0))).toBe(true);
  });

  it("昨天的运行不计入：次日窗口重新开始", () => {
    const t = task({
      schedule: { ...window },
      lastRunAt: at(2026, 10, 12, 17, 30),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 9, 0))).toBe(true);
  });

  it("结构非法（起止相等/间隔 0）永不到期", () => {
    expect(
      isTaskDue(
        task({ schedule: { kind: "window", startTime: "09:00", endTime: "09:00", everyMinutes: 5 } }),
        9e15,
      ),
    ).toBe(false);
    expect(
      isTaskDue(
        task({ schedule: { kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 0 } }),
        9e15,
      ),
    ).toBe(false);
  });
});

describe("isTaskDue（未知 kind）", () => {
  it("永不到期", () => {
    const t = task({ schedule: { kind: "rrule" } as unknown as ScheduledTaskSchedule });
    expect(isTaskDue(t, 9e15)).toBe(false);
  });
});

describe("parseLocalDate / localDateISO", () => {
  it("合法日期往返一致", () => {
    const d = new Date(2026, 9, 13);
    expect(localDateISO(d)).toBe("2026-10-13");
    expect(parseLocalDate("2026-10-13")?.getTime()).toBe(d.getTime());
  });

  it("拒绝非法/越界日期（如 2 月 30 日）", () => {
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-13-01")).toBeNull();
    expect(parseLocalDate("20261013")).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
  });
});

describe("isValidSchedule（recurrence）", () => {
  it("天/周/月需 every + unit + 非空 times；周另需 weekdays、月另需 monthlyOn", () => {
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: ["09:00"] }),
    ).toBe(true);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: ["09:00", "18:30"] }),
    ).toBe(true);
    expect(isValidSchedule({ kind: "recurrence", every: 1, unit: "day" })).toBe(false);
    expect(isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: [] })).toBe(false);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: ["25:00"] }),
    ).toBe(false);

    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "week",
        weekdays: [1, 3],
        times: ["09:00"],
      }),
    ).toBe(true);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "week", times: ["09:00"] }),
    ).toBe(false);
    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "week",
        weekdays: [],
        times: ["09:00"],
      }),
    ).toBe(false);
    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "week",
        weekdays: [7],
        times: ["09:00"],
      }),
    ).toBe(false);

    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 2,
        unit: "month",
        monthlyOn: { mode: "day", day: 15 },
        times: ["09:00"],
      }),
    ).toBe(true);
    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "month",
        monthlyOn: { mode: "nthWeekday", nth: 2, weekday: 2 },
        times: ["09:00"],
      }),
    ).toBe(true);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "month", times: ["09:00"] }),
    ).toBe(false);
    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "month",
        monthlyOn: { mode: "day", day: 32 },
        times: ["09:00"],
      }),
    ).toBe(false);
    expect(
      isValidSchedule({
        kind: "recurrence",
        every: 1,
        unit: "month",
        monthlyOn: { mode: "nthWeekday", nth: 6, weekday: 2 },
        times: ["09:00"],
      }),
    ).toBe(false);
  });

  it("秒/分/时无需 times；until 需为合法日期", () => {
    expect(isValidSchedule({ kind: "recurrence", every: 30, unit: "minute" })).toBe(true);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: ["09:00"], until: "2026-12-31" }),
    ).toBe(true);
    expect(
      isValidSchedule({ kind: "recurrence", every: 1, unit: "day", times: ["09:00"], until: "2026-02-30" }),
    ).toBe(false);
    expect(isValidSchedule({ kind: "recurrence", every: 0, unit: "day", times: ["09:00"] })).toBe(
      false,
    );
  });

  it("dates 需非空日期列表 + 非空 times", () => {
    expect(
      isValidSchedule({ kind: "dates", dates: ["2026-10-15", "2026-11-03"], times: ["09:00"] }),
    ).toBe(true);
    expect(isValidSchedule({ kind: "dates", dates: [], times: ["09:00"] })).toBe(false);
    expect(isValidSchedule({ kind: "dates", dates: ["2026-10-15"] })).toBe(false);
    expect(
      isValidSchedule({ kind: "dates", dates: ["bad"], times: ["09:00"] }),
    ).toBe(false);
  });
});

describe("isTaskDue（recurrence）", () => {
  it("秒/分/时按 interval 语义（距上次运行满 N 单位）", () => {
    const t = task({
      schedule: { kind: "recurrence", every: 30, unit: "minute" },
      createdAt: at(2026, 10, 13, 9, 0),
      lastRunAt: at(2026, 10, 13, 9, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 9, 29))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 9, 30))).toBe(true);
  });

  it("天：匹配日到各时刻各触发一次（多时刻共享单一 lastRunAt）", () => {
    const t = task({
      schedule: { kind: "recurrence", every: 1, unit: "day", times: ["09:00", "18:00"] },
      createdAt: at(2026, 10, 13, 8, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 13, 8, 59))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 13, 9, 0))).toBe(true);
    // 09:00 已跑，18:00 未到 → 12:00 不触发
    const afterMorning = { ...t, lastRunAt: at(2026, 10, 13, 9, 0) };
    expect(isTaskDue(afterMorning, at(2026, 10, 13, 12, 0))).toBe(false);
    expect(isTaskDue(afterMorning, at(2026, 10, 13, 18, 0))).toBe(true);
    // 两个时刻都跑过 → 当天不再触发
    const afterEvening = { ...t, lastRunAt: at(2026, 10, 13, 18, 0) };
    expect(isTaskDue(afterEvening, at(2026, 10, 13, 23, 0))).toBe(false);
    // 次日重新开始
    expect(isTaskDue(afterEvening, at(2026, 10, 14, 9, 0))).toBe(true);
  });

  it("天：every=2 时隔天触发（纪元对齐）", () => {
    const t = task({
      schedule: { kind: "recurrence", every: 2, unit: "day", times: ["09:00"] },
      createdAt: at(2026, 10, 10, 0, 0),
    });
    // 2026-10-12 距纪元天数为偶数（对齐），10-13 为奇数
    const oct12 = matchesDate(t.schedule, 2026, 9, 12);
    const oct13 = matchesDate(t.schedule, 2026, 9, 13);
    expect(oct12).toBe(!oct13);
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 12, 9, 0) }, at(2026, 10, 13, 9, 0))).toBe(
      oct13,
    );
  });

  it("周：仅选中周几触发；every=2 时隔周", () => {
    const weekly = task({
      schedule: {
        kind: "recurrence",
        every: 1,
        unit: "week",
        weekdays: [1, 4], // 周一、周四
        times: ["09:00"],
      },
      createdAt: at(2026, 10, 12, 0, 0), // 周一
    });
    // 2026-10-12 周一、10-15 周四
    expect(matchesDate(weekly.schedule, 2026, 9, 12)).toBe(true);
    expect(matchesDate(weekly.schedule, 2026, 9, 13)).toBe(false);
    expect(matchesDate(weekly.schedule, 2026, 9, 15)).toBe(true);
    expect(isTaskDue(weekly, at(2026, 10, 13, 9, 0))).toBe(false);
    expect(isTaskDue(weekly, at(2026, 10, 15, 9, 0))).toBe(true);

    const biweekly = { ...weekly, schedule: { ...weekly.schedule, every: 2 } };
    // 10-12 与 10-19 相差一周（隔周）：两者 weekIndex 奇偶不同，恰有一个匹配
    expect(matchesDate(biweekly.schedule, 2026, 9, 12)).not.toBe(
      matchesDate(biweekly.schedule, 2026, 9, 19),
    );
  });

  it("月：几号模式（月末收敛）与第 N 个周几模式", () => {
    const byDay = task({
      schedule: {
        kind: "recurrence",
        every: 1,
        unit: "month",
        monthlyOn: { mode: "day", day: 31 },
        times: ["09:00"],
      },
      createdAt: at(2026, 1, 31, 0, 0),
    });
    // 2 月 31 → 收敛到 2/28
    expect(isTaskDue(byDay, at(2026, 2, 27, 23, 59))).toBe(false);
    expect(isTaskDue(byDay, at(2026, 2, 28, 9, 0))).toBe(true);

    // 2026-10 的第 2 个周二 = 10/13
    const byNth = task({
      schedule: {
        kind: "recurrence",
        every: 1,
        unit: "month",
        monthlyOn: { mode: "nthWeekday", nth: 2, weekday: 2 },
        times: ["09:00"],
      },
      createdAt: at(2026, 10, 1, 0, 0),
    });
    expect(matchesDate(byNth.schedule, 2026, 9, 6)).toBe(false); // 第 1 个周二
    expect(matchesDate(byNth.schedule, 2026, 9, 13)).toBe(true); // 第 2 个周二
    expect(matchesDate(byNth.schedule, 2026, 9, 20)).toBe(false); // 第 3 个周二
    expect(isTaskDue(byNth, at(2026, 10, 13, 9, 0))).toBe(true);
  });

  it("until 截止日当天仍触发，之后不再", () => {
    const t = task({
      schedule: { kind: "recurrence", every: 1, unit: "day", times: ["09:00"], until: "2026-10-15" },
      createdAt: at(2026, 10, 1, 0, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 15, 9, 0))).toBe(true);
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 15, 9, 0) }, at(2026, 10, 16, 9, 0))).toBe(
      false,
    );
    expect(matchesDate(t.schedule, 2026, 9, 16)).toBe(false);
  });
});

describe("isTaskDue（dates）", () => {
  it("仅选中日期的选中时刻触发；其余日期永不到期", () => {
    const t = task({
      schedule: { kind: "dates", dates: ["2026-10-15", "2026-11-03"], times: ["09:00", "20:00"] },
      createdAt: at(2026, 10, 1, 0, 0),
    });
    expect(isTaskDue(t, at(2026, 10, 14, 9, 0))).toBe(false);
    expect(isTaskDue(t, at(2026, 10, 15, 9, 0))).toBe(true);
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 15, 9, 0) }, at(2026, 10, 15, 20, 0))).toBe(
      true,
    );
    expect(isTaskDue({ ...t, lastRunAt: at(2026, 10, 15, 20, 0) }, at(2026, 10, 16, 9, 0))).toBe(
      false,
    );
    expect(isTaskDue(t, at(2026, 11, 3, 20, 0))).toBe(true);
  });
});

describe("matchesDate", () => {
  it("旧类型：daily/window 每天匹配，monthly 按几号，once 按 at，interval 恒 false", () => {
    expect(matchesDate({ kind: "daily", time: "09:00" }, 2026, 9, 13)).toBe(true);
    expect(
      matchesDate(
        { kind: "window", startTime: "09:00", endTime: "18:00", everyMinutes: 30 },
        2026,
        9,
        13,
      ),
    ).toBe(true);
    expect(matchesDate({ kind: "monthly", day: 15, time: "09:00" }, 2026, 9, 15)).toBe(true);
    expect(matchesDate({ kind: "monthly", day: 15, time: "09:00" }, 2026, 9, 14)).toBe(false);
    expect(
      matchesDate({ kind: "once", at: at(2026, 10, 14, 9, 0) }, 2026, 9, 14),
    ).toBe(true);
    expect(
      matchesDate({ kind: "interval", every: 1, unit: "day" }, 2026, 9, 14),
    ).toBe(false);
  });
});

describe("nextOccurrences", () => {
  it("间隔类：从 from 起按步进估算", () => {
    const from = at(2026, 10, 13, 9, 0);
    expect(nextOccurrences({ kind: "interval", every: 30, unit: "minute" }, from, 3)).toEqual([
      from + 30 * 60_000,
      from + 60 * 60_000,
      from + 90 * 60_000,
    ]);
    expect(nextOccurrences({ kind: "recurrence", every: 1, unit: "hour" }, from, 2)).toEqual([
      from + 3_600_000,
      from + 7_200_000,
    ]);
  });

  it("once：at 在未来才返回", () => {
    const from = at(2026, 10, 13, 9, 0);
    expect(nextOccurrences({ kind: "once", at: at(2026, 10, 14, 9, 0) }, from, 3)).toEqual([
      at(2026, 10, 14, 9, 0),
    ]);
    expect(nextOccurrences({ kind: "once", at: from - 1 }, from, 3)).toEqual([]);
  });

  it("recurrence 天多时刻：跨日收集未来时刻", () => {
    const from = at(2026, 10, 13, 12, 0);
    const schedule: ScheduledTaskSchedule = {
      kind: "recurrence",
      every: 1,
      unit: "day",
      times: ["09:00", "18:00"],
    };
    expect(nextOccurrences(schedule, from, 3)).toEqual([
      at(2026, 10, 13, 18, 0),
      at(2026, 10, 14, 9, 0),
      at(2026, 10, 14, 18, 0),
    ]);
  });

  it("recurrence 周几：只在选中周几出现", () => {
    const from = at(2026, 10, 13, 12, 0); // 周二
    const schedule: ScheduledTaskSchedule = {
      kind: "recurrence",
      every: 1,
      unit: "week",
      weekdays: [1, 4], // 周一、周四
      times: ["09:00"],
    };
    expect(nextOccurrences(schedule, from, 3)).toEqual([
      at(2026, 10, 15, 9, 0), // 周四
      at(2026, 10, 19, 9, 0), // 下周一
      at(2026, 10, 22, 9, 0), // 下周四
    ]);
  });

  it("window：窗口内按 everyMinutes 生成序列", () => {
    const from = at(2026, 10, 13, 10, 30);
    const schedule: ScheduledTaskSchedule = {
      kind: "window",
      startTime: "09:00",
      endTime: "11:00",
      everyMinutes: 60,
    };
    expect(nextOccurrences(schedule, from, 3)).toEqual([
      at(2026, 10, 13, 11, 0),
      at(2026, 10, 14, 9, 0),
      at(2026, 10, 14, 10, 0),
    ]);
  });

  it("dates：只取选中日期的时刻", () => {
    const from = at(2026, 10, 13, 12, 0);
    const schedule: ScheduledTaskSchedule = {
      kind: "dates",
      dates: ["2026-10-15", "2026-11-03"],
      times: ["09:00"],
    };
    expect(nextOccurrences(schedule, from, 3)).toEqual([
      at(2026, 10, 15, 9, 0),
      at(2026, 11, 3, 9, 0),
    ]);
  });

  it("count<=0 或 400 天内无匹配返回空数组", () => {
    expect(nextOccurrences({ kind: "interval", every: 1, unit: "minute" }, 0, 0)).toEqual([]);
    const from = at(2026, 10, 13, 12, 0);
    expect(
      nextOccurrences(
        { kind: "dates", dates: ["2020-01-01"], times: ["09:00"] },
        from,
        3,
      ),
    ).toEqual([]);
  });
});
