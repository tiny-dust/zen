import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd() },
}));

import { syncBuiltinSkills } from "./builtin-skills";

async function makeSource(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zen-skills-src-"));
  await mkdir(join(root, "skill-router"), { recursive: true });
  await writeFile(join(root, "skill-router", "SKILL.md"), content, "utf8");
  return root;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTarget(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zen-skills-dst-"));
  roots.push(dir);
  return dir;
}

describe("syncBuiltinSkills", () => {
  it("首次同步把内置技能写入目标技能根", async () => {
    const source = await makeSource("# skill router v1\n");
    roots.push(source);
    const target = await makeTarget();

    await expect(syncBuiltinSkills(source, target)).resolves.toEqual(["skill-router"]);
    await expect(readFile(join(target, "skill-router", "SKILL.md"), "utf8")).resolves.toBe(
      "# skill router v1\n",
    );
  });

  it("内容一致时不重复写盘", async () => {
    const source = await makeSource("# skill router v1\n");
    roots.push(source);
    const target = await makeTarget();

    await syncBuiltinSkills(source, target);
    await expect(syncBuiltinSkills(source, target)).resolves.toEqual([]);
  });

  it("内置技能内容更新后覆盖目标（zen 拥有该技能）", async () => {
    const source = await makeSource("# skill router v2\n");
    roots.push(source);
    const target = await makeTarget();
    await mkdir(join(target, "skill-router"), { recursive: true });
    await writeFile(join(target, "skill-router", "SKILL.md"), "# old\n", "utf8");

    await expect(syncBuiltinSkills(source, target)).resolves.toEqual(["skill-router"]);
    await expect(readFile(join(target, "skill-router", "SKILL.md"), "utf8")).resolves.toBe(
      "# skill router v2\n",
    );
  });

  it("模板目录不存在时静默返回空", async () => {
    const target = await makeTarget();
    await expect(syncBuiltinSkills(join(tmpdir(), "zen-no-such-src"), target)).resolves.toEqual([]);
  });
});
