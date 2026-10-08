import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSkillUsageStore, usageTargetFromTool } from "@/stores/skill-usage";

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usageTargetFromTool 边界", () => {
  it("loadSkill 无 skillId / 非技能工具返回 null", () => {
    expect(usageTargetFromTool("loadSkill", {})).toBeNull();
    expect(usageTargetFromTool("loadSkill", null)).toBeNull();
    expect(usageTargetFromTool("loadSkill", { skillId: "" })).toBeNull();
    expect(usageTargetFromTool("readFile", { path: "/a" })).toBeNull();
    expect(usageTargetFromTool("mcp.", {})).toBeNull();
    expect(usageTargetFromTool("mcp", {})).toBeNull();
  });

  it("未知技能 id 回落路径尾段作展示名", () => {
    const target = usageTargetFromTool("loadSkill", { skillId: "/a/b/my-skill" });
    expect(target).toEqual({ key: "skill:my-skill", kind: "skill", name: "my-skill" });
    // Windows 路径
    const win = usageTargetFromTool("loadSkill", { skillId: "C:\\skills\\win-skill" });
    expect(win?.name).toBe("win-skill");
    // 只有分隔符时回落整个 id
    const odd = usageTargetFromTool("loadSkill", { skillId: "/" });
    expect(odd?.name).toBe("/");
  });
});

describe("useSkillUsageStore 补充行为", () => {
  it("noteSkills 忽略空名称，与 loadSkill 记录合并", () => {
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "coder" });
    store.noteSkills("s1", ["", "  ", "coder"]);
    const entries = store.entriesOf("s1");
    expect(entries).toHaveLength(1);
    // loadSkill 1 次 + noteSkills 1 次
    expect(entries[0]?.calls).toBe(2);
    // noteSkills 视为已完成调用
    expect(entries[0]?.running).toBe(false);
  });

  it("noteToolEnd 失败也结束进行中动效", () => {
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "mcp.filesystem.read", {});
    expect(store.entriesOf("s1")[0]?.running).toBe(true);
    store.noteToolEnd("s1", "mcp.filesystem.read", false, {});
    expect(store.entriesOf("s1")[0]?.running).toBe(false);
  });

  it("noteToolEnd 找不到对应条目 / 非技能工具不报错", () => {
    const store = useSkillUsageStore();
    store.noteToolEnd("s1", "loadSkill", true, { skillId: "never-started" });
    store.noteToolEnd("s1", "readFile", true, {});
    expect(store.entriesOf("s1")).toEqual([]);
  });

  it("endRun 清掉所有进行中动效", () => {
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "a" });
    store.noteToolStart("s1", "mcp.srv.tool", {});
    store.endRun("s1");
    expect(store.entriesOf("s1").every((item) => !item.running)).toBe(true);
  });

  it("会话之间互不影响", () => {
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "a" });
    expect(store.entriesOf("s2")).toEqual([]);
  });

  it("超量时挤掉最旧的一条", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const store = useSkillUsageStore();
    for (let i = 0; i < 16; i += 1) {
      vi.setSystemTime(1000 + i);
      store.noteToolStart("s1", "loadSkill", { skillId: `skill-${i}` });
    }
    expect(store.entriesOf("s1")).toHaveLength(16);
    vi.setSystemTime(2000);
    store.noteToolStart("s1", "loadSkill", { skillId: "skill-new" });
    const entries = store.entriesOf("s1");
    expect(entries).toHaveLength(16);
    expect(entries.some((item) => item.name === "skill-0")).toBe(false);
    expect(entries.some((item) => item.name === "skill-new")).toBe(true);
  });

  it("挤掉最旧条目时清理其呼吸定时器", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const store = useSkillUsageStore();
    for (let i = 0; i < 16; i += 1) {
      store.noteToolStart("s1", "loadSkill", { skillId: `skill-${i}` });
    }
    // 时间戳并列：skill-0 再调用拿到呼吸定时器，但仍是队首要被挤掉的条目
    store.noteToolStart("s1", "loadSkill", { skillId: "skill-0" });
    store.noteToolStart("s1", "loadSkill", { skillId: "skill-new" });
    const entries = store.entriesOf("s1");
    expect(entries).toHaveLength(16);
    expect(entries.some((item) => item.name === "skill-0")).toBe(false);
  });

  it("再次调用的呼吸高亮到期后复位", () => {
    vi.useFakeTimers();
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "coder" });
    store.noteToolStart("s1", "loadSkill", { skillId: "coder" });
    expect(store.entriesOf("s1")[0]?.breathUntil).toBeGreaterThan(0);
    vi.advanceTimersByTime(10_000);
    expect(store.entriesOf("s1")[0]?.breathUntil).toBe(0);
  });
});
