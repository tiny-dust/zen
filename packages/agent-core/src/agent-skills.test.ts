import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readSkillById } from "@zen/skills";

/**
 * loadSkill 解析回归：skillId 支持技能名（模型常用）与技能目录 id；
 * 白名单外 / 不存在的键必须返回 null（由工具层报 "skill not found or not allowed"）。
 * fixtures 放临时目录，避免依赖本机 ~/.claude、~/.agents 技能。
 */

const SKILL_NAME = "zen-test-skill-unique";
let fixtureRoot: string;
let skillDir: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "zen-skills-test-"));
  skillDir = join(fixtureRoot, SKILL_NAME);
  mkdirSync(skillDir);
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${SKILL_NAME}\ndescription: fixture skill\n---\n\n# Body\n\nfixture body text\n`,
    "utf8",
  );
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("readSkillById", () => {
  it("按技能名解析（skillId 传 name）", async () => {
    const found = await readSkillById(SKILL_NAME, [fixtureRoot]);
    expect(found?.name).toBe(SKILL_NAME);
    expect(found?.body).toContain("fixture body text");
  });

  it("按技能目录 id 解析（skillId 传绝对路径）", async () => {
    const found = await readSkillById(skillDir, [fixtureRoot]);
    expect(found?.name).toBe(SKILL_NAME);
    expect(found?.body).toContain("fixture body text");
  });

  it("不存在的名称返回 null", async () => {
    expect(await readSkillById("zen-test-skill-missing", [fixtureRoot])).toBeNull();
  });

  it("白名单外的绝对路径返回 null", async () => {
    expect(await readSkillById("/etc/passwd", [fixtureRoot])).toBeNull();
  });

  it("相对路径逃逸返回 null", async () => {
    expect(await readSkillById("../../../etc/passwd", [fixtureRoot])).toBeNull();
  });
});
