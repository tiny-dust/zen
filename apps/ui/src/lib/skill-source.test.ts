import { describe, expect, it } from "vitest";

import { skillSourceLabel } from "@/lib/skill-source";

describe("skillSourceLabel", () => {
  it("按所在目录归类来源", () => {
    expect(skillSourceLabel({ dir: "/home/u/.zen/skills/foo" })).toBe("Zen");
    expect(skillSourceLabel({ dir: "/home/u/.claude/skills/foo" })).toBe("Claude");
    expect(skillSourceLabel({ dir: "/home/u/.agents/skills/foo" })).toBe("Agents");
    expect(skillSourceLabel({ dir: "/home/u/skills/foo" })).toBe("自定义");
    expect(skillSourceLabel({ dir: "/opt/mcp/tools" })).toBe("自定义");
  });

  it("兼容 Windows 反斜杠路径", () => {
    expect(skillSourceLabel({ dir: "C:\\Users\\u\\.zen\\skills\\foo" })).toBe("Zen");
    expect(skillSourceLabel({ dir: "C:\\Users\\u\\.claude\\skills\\foo" })).toBe("Claude");
    expect(skillSourceLabel({ dir: "C:\\Users\\u\\.agents\\skills\\foo" })).toBe("Agents");
    expect(skillSourceLabel({ dir: "C:\\Users\\u\\skills\\foo" })).toBe("自定义");
  });
});
