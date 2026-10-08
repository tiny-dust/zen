import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { builtinSkillDirs, listSkills, readSkillById, scanSkillDir } from "./index";

/**
 * 技能加载器（hermetic：mock homedir 指向临时 HOME）：
 * - scanSkillDir：根即技能 / 子目录技能 / dot 目录与文件跳过 / frontmatter 兜底与坏解析
 * - listSkills：按名去重（~/.zen > ~/.claude > ~/.agents > 自定义）、source/removable 标记
 * - readSkillById：绝对路径需在允许根内，按名/目录名解析，找不到返回 null
 */

const fakeHome = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome.path };
});

function writeSkill(dir: string, frontmatter: string, body = "技能正文"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

let extraRoot = "";

beforeAll(() => {
  fakeHome.path = mkdtempSync(join(tmpdir(), "zen-skills-home-"));
  extraRoot = mkdtempSync(join(tmpdir(), "zen-skills-extra-"));

  // 三级内置目录：同名技能只保留 ~/.zen 的那个
  writeSkill(join(fakeHome.path, ".zen", "skills", "zen-alpha"), "name: alpha\ndescription: 来自 zen");
  writeSkill(join(fakeHome.path, ".claude", "skills", "claude-alpha"), "name: alpha\ndescription: 来自 claude");
  writeSkill(join(fakeHome.path, ".agents", "skills", "agents-beta"), "name: beta\ndescription: 来自 agents");
  // 自定义路径
  writeSkill(join(extraRoot, "extra-gamma"), "name: gamma\ndescription: 自定义技能");
  // frontmatter 缺 name → 目录名兜底
  writeSkill(join(extraRoot, "dir-name-skill"), "description: 无名");
  // 坏 frontmatter → 整个跳过
  mkdirSync(join(extraRoot, "broken-skill"), { recursive: true });
  writeFileSync(join(extraRoot, "broken-skill", "SKILL.md"), "---\nname: [unclosed\n---\nbody");
  // dot 目录与普通文件不扫
  writeSkill(join(extraRoot, ".hidden-skill"), "name: hidden");
  writeFileSync(join(extraRoot, "plain.txt"), "x");
});

afterAll(() => {
  rmSync(fakeHome.path, { recursive: true, force: true });
  rmSync(extraRoot, { recursive: true, force: true });
});

describe("builtinSkillDirs", () => {
  it("返回 HOME 下的三个技能根目录", () => {
    expect(builtinSkillDirs()).toEqual([
      join(fakeHome.path, ".zen", "skills"),
      join(fakeHome.path, ".claude", "skills"),
      join(fakeHome.path, ".agents", "skills"),
    ]);
  });
});

describe("scanSkillDir", () => {
  it("不存在或不是目录时返回 []", async () => {
    await expect(scanSkillDir(join(tmpdir(), "zen-no-such-dir-xyz"))).resolves.toEqual([]);
    await expect(scanSkillDir(join(extraRoot, "plain.txt"))).resolves.toEqual([]);
  });

  it("子目录技能逐个加载，dot 目录/坏 frontmatter 跳过", async () => {
    const skills = await scanSkillDir(extraRoot);
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    expect(byId.has(join(extraRoot, "extra-gamma"))).toBe(true);
    expect(byId.get(join(extraRoot, "extra-gamma"))).toMatchObject({
      name: "gamma",
      description: "自定义技能",
      body: "技能正文",
    });
    expect(byId.get(join(extraRoot, "dir-name-skill"))?.name).toBe("dir-name-skill");
    expect(byId.has(join(extraRoot, "broken-skill"))).toBe(false);
    expect(byId.has(join(extraRoot, ".hidden-skill"))).toBe(false);
  });

  it("根目录本身就是技能时只返回它，不再扫子目录", async () => {
    const rootSkill = join(fakeHome.path, "root-only");
    writeSkill(rootSkill, "name: root-only", "根技能正文");
    const skills = await scanSkillDir(rootSkill);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "root-only", body: "根技能正文" });
  });

  it("支持 ~ 前缀路径", async () => {
    const skills = await scanSkillDir("~/.agents/skills");
    expect(skills.some((skill) => skill.name === "beta")).toBe(true);
  });
});

describe("listSkills", () => {
  it("同名技能按目录优先级去重，标记 source/removable", async () => {
    const skills = await listSkills([extraRoot]);
    const alpha = skills.filter((skill) => skill.name === "alpha");
    expect(alpha).toHaveLength(1);
    expect(alpha[0]?.id).toBe(join(fakeHome.path, ".zen", "skills", "zen-alpha"));
    expect(alpha[0]?.source).toBe("user");
    expect(alpha[0]?.removable).toBe(true);
    expect(alpha[0]?.disabled).toBe(false);

    const gamma = skills.find((skill) => skill.name === "gamma");
    // 自定义路径不在内置根下：source 归 builtin 但不可移除
    expect(gamma).toMatchObject({ source: "builtin", removable: false });
  });

  it("过滤空白自定义路径", async () => {
    const skills = await listSkills(["  ", ""]);
    expect(skills.some((skill) => skill.name === "beta")).toBe(true);
    expect(skills.some((skill) => skill.name === "gamma")).toBe(false);
  });
});

describe("readSkillById", () => {
  it("空 id 或未知技能返回 null", async () => {
    await expect(readSkillById("", [extraRoot])).resolves.toBeNull();
    await expect(readSkillById("   ", [extraRoot])).resolves.toBeNull();
    await expect(readSkillById("no-such-skill-xyz", [extraRoot])).resolves.toBeNull();
  });

  it("绝对路径必须落在允许根内", async () => {
    const allowed = join(extraRoot, "extra-gamma");
    await expect(readSkillById(allowed, [extraRoot])).resolves.toEqual({
      name: "gamma",
      body: "技能正文",
    });

    const outside = join(fakeHome.path, "root-only");
    // root-only 不在任何允许根下 → null
    await expect(readSkillById(outside, [extraRoot])).resolves.toBeNull();
  });

  it("按技能名与目录名解析，读取正文", async () => {
    await expect(readSkillById("gamma", [extraRoot])).resolves.toEqual({
      name: "gamma",
      body: "技能正文",
    });
    await expect(readSkillById("dir-name-skill", [extraRoot])).resolves.toEqual({
      name: "dir-name-skill",
      body: "技能正文",
    });
  });
});
