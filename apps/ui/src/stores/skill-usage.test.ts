import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAgentStore } from "@/stores/agent";
import { useSkillUsageStore, usageTargetFromTool } from "@/stores/skill-usage";

describe("skill-usage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("window", {
      zen: {
        agent: {
          listSkills: async () => [
            {
              id: "/home/u/.claude/skills/coder",
              name: "coder",
              description: "",
              dir: "/home/u/.claude/skills/coder",
              source: "builtin",
              removable: true,
              disabled: false,
            },
          ],
        },
      },
    });
  });

  it("merges same skill name under different ids into one tag", async () => {
    await useAgentStore().refreshSkills();
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "/home/u/.claude/skills/coder" });
    store.noteToolEnd("s1", "loadSkill", true, { skillId: "/home/u/.claude/skills/coder" });
    store.noteSkills("s1", ["coder"]);

    const entries = store.entriesOf("s1");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("coder");
    expect(entries[0]?.calls).toBe(2);
  });

  it("keeps first call without breath and pulses on re-call", async () => {
    vi.useFakeTimers();
    await useAgentStore().refreshSkills();
    const store = useSkillUsageStore();
    store.noteToolStart("s1", "loadSkill", { skillId: "coder" });
    const first = store.entriesOf("s1")[0];
    expect(first?.calls).toBe(1);
    expect(first?.breathUntil).toBe(0);

    store.noteToolStart("s1", "loadSkill", { skillId: "coder" });
    const second = store.entriesOf("s1")[0];
    expect(second?.calls).toBe(2);
    expect(second?.breathUntil).toBeGreaterThan(0);
    expect(second?.breathSeq).toBe(1);

    vi.advanceTimersByTime(10_000);
    expect(store.entriesOf("s1")[0]?.breathUntil).toBe(0);
    vi.useRealTimers();
  });

  it("resolves loadSkill target to display name key", () => {
    const target = usageTargetFromTool("loadSkill", { skillId: "/a/b/my-skill" });
    expect(target).toEqual({ key: "skill:my-skill", kind: "skill", name: "my-skill" });
    const mcp = usageTargetFromTool("mcp.filesystem.read", {});
    expect(mcp).toEqual({ key: "mcp:filesystem", kind: "mcp", name: "filesystem" });
  });
});
