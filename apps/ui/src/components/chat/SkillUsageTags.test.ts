import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SkillUsageTags from "@/components/chat/SkillUsageTags.vue";
import { useSkillUsageStore } from "@/stores/skill-usage";

import type { SkillFileInfo, SkillSummary } from "@zen/shared";

const skillFiles = vi.hoisted(() => vi.fn());

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({ sessionId: "s1" }),
}));

vi.mock("@/stores/agent", () => ({
  useAgentStore: () => ({
    skills: [
      { id: "/skills/ponytail", name: "ponytail", dir: "/skills/ponytail" },
    ] as SkillSummary[],
    skillFiles,
  }),
}));

async function mountWithFiles(files: SkillFileInfo[]) {
  skillFiles.mockResolvedValueOnce(files);
  useSkillUsageStore().noteSkills("s1", ["ponytail"]);
  const wrapper = mount(SkillUsageTags);
  await flushPromises();
  return wrapper;
}

describe("SkillUsageTags 技能 tag", () => {
  beforeEach(() => {
    skillFiles.mockReset();
  });

  it("tag 出现时不预拉技能文件（点击弹层才拉）", async () => {
    const wrapper = await mountWithFiles([
      { path: "SKILL.md", size: 10 },
      { path: "stats/dashboard.json", size: 20 },
    ]);
    expect(wrapper.text()).toContain("ponytail");
    expect(skillFiles).not.toHaveBeenCalled();
  });

  it("技能带看板/数据文件也不再给 tag 加独特样式", async () => {
    const wrapper = await mountWithFiles([
      { path: "SKILL.md", size: 10 },
      { path: "stats/dashboard.json", size: 20 },
    ]);
    expect(wrapper.find("button.skill-tag-extra").exists()).toBe(false);
  });
});
