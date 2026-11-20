import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  builtinSkillDirs,
  listSkillFiles,
  listSkills,
  readSkillById,
  readSkillFile,
  readSkillPanel,
  scanSkillDir,
} from "./index";

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
  // 兼容目录根混入根级 SKILL.md（旧版 CLI 会这么落）时，子目录技能仍必须可见
  writeSkill(join(fakeHome.path, ".claude", "skills"), "name: claude-root\ndescription: 根级技能");
  writeSkill(join(fakeHome.path, ".claude", "skills", "claude-only-skill"), "name: delta\ndescription: claude 子目录技能");
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

  it("根目录本身就是技能时连同子目录技能一并返回", async () => {
    const rootSkill = join(fakeHome.path, "root-only");
    writeSkill(rootSkill, "name: root-only", "根技能正文");
    writeSkill(join(rootSkill, "child-skill"), "name: child-skill");
    const skills = await scanSkillDir(rootSkill);
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    expect(byName.get("root-only")).toMatchObject({ name: "root-only", body: "根技能正文" });
    expect(byName.get("child-skill")).toMatchObject({ name: "child-skill" });
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

  it("根级 SKILL.md 不遮蔽子目录技能，且根目录本身不可卸载", async () => {
    const skills = await listSkills([]);
    // 根级技能（~/.claude/skills/SKILL.md）与其子目录技能同时可见
    const root = skills.find((skill) => skill.name === "claude-root");
    expect(root?.dir).toBe(join(fakeHome.path, ".claude", "skills"));
    expect(root?.removable).toBe(false);
    expect(skills.some((skill) => skill.name === "delta")).toBe(true);
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

describe("listSkillFiles", () => {
  it("递归枚举技能目录文件，SKILL.md 排最前，dot 目录跳过", async () => {
    const dir = join(fakeHome.path, ".zen", "skills", "zen-alpha");
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "references", "baseline.md"), "# 规范");
    writeFileSync(join(dir, ".gitignore"), "*");
    const files = await listSkillFiles(dir, [extraRoot]);
    const paths = files.map((file) => file.path);
    expect(paths[0]).toBe("SKILL.md");
    expect(paths).toContain("references/baseline.md");
    expect(paths.some((path) => path.startsWith(".git"))).toBe(false);
    const skillMd = files.find((file) => file.path === "SKILL.md");
    expect(skillMd?.size).toBeGreaterThan(0);
  });

  it("不在允许根下的目录返回空", async () => {
    const outside = join(fakeHome.path, "root-only");
    await expect(listSkillFiles(outside, [extraRoot])).resolves.toEqual([]);
    await expect(listSkillFiles(join(tmpdir(), "zen-no-such-dir-xyz"), [])).resolves.toEqual([]);
  });
});

describe("readSkillFile", () => {
  // extraRoot 在 beforeAll 才赋值：describe 体内不可提前求值，需惰性取
  const gammaDir = () => join(extraRoot, "extra-gamma");

  it("读取技能目录内文件", async () => {
    const result = await readSkillFile(gammaDir(), "SKILL.md", [extraRoot]);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("技能正文");
    expect(result.truncated).toBeFalsy();
  });

  it("目录不在允许根内时拒绝", async () => {
    const result = await readSkillFile(join(fakeHome.path, "root-only"), "SKILL.md", [extraRoot]);
    expect(result.ok).toBe(false);
  });

  it("拒绝绝对路径与越权相对路径", async () => {
    const abs = await readSkillFile(gammaDir(), join(fakeHome.path, "plain.txt"), [extraRoot]);
    expect(abs.ok).toBe(false);
    const escape = await readSkillFile(gammaDir(), "../plain.txt", [extraRoot]);
    expect(escape.ok).toBe(false);
    const deepEscape = await readSkillFile(gammaDir(), "references/../../plain.txt", [extraRoot]);
    expect(deepEscape.ok).toBe(false);
  });

  it("二进制（含 NUL 字节）与不存在文件返回错误", async () => {
    mkdirSync(join(gammaDir(), "assets"), { recursive: true });
    writeFileSync(join(gammaDir(), "assets", "icon.png"), Buffer.from([0x89, 0x00, 0x50]));
    const binary = await readSkillFile(gammaDir(), "assets/icon.png", [extraRoot]);
    expect(binary.ok).toBe(false);
    const missing = await readSkillFile(gammaDir(), "no-such-file.md", [extraRoot]);
    expect(missing.ok).toBe(false);
  });
});

describe("readSkillPanel", () => {
  let panelRoot = "";

  beforeAll(() => {
    panelRoot = mkdtempSync(join(tmpdir(), "zen-skills-panel-"));
  });

  afterAll(() => {
    rmSync(panelRoot, { recursive: true, force: true });
  });

  /** 建一个面板 fixture 目录：panel 传字符串时原样落盘（造坏 JSON 用） */
  function writePanelDir(name: string, panel: unknown): string {
    const dir = join(panelRoot, name);
    mkdirSync(join(dir, "ui"), { recursive: true });
    writeFileSync(join(dir, "panel.json"), typeof panel === "string" ? panel : JSON.stringify(panel));
    return dir;
  }

  it("正常清单 + ui 文件：manifest 字段齐全，html 有内容", async () => {
    const dir = writePanelDir("full", {
      version: 1,
      title: "  指标看板  ",
      showOnSkillUse: false,
      ui: "ui/board.html",
      metrics: ["rounds", "bogus", "rounds", "tools", 42],
      commands: { toggle: "toggle", "  hide  ": "toggle", "do-thing": "run", "": "toggle" },
    });
    writeFileSync(join(dir, "ui", "board.html"), "<h1>指标看板</h1>");

    const info = await readSkillPanel(dir, [panelRoot]);
    expect(info?.dir).toBe(dir);
    expect(info?.manifest).toEqual({
      version: 1,
      title: "指标看板",
      showOnSkillUse: false,
      ui: "ui/board.html",
      metrics: ["rounds", "tools"],
      commands: { toggle: "toggle", hide: "toggle" },
    });
    expect(info?.html).toContain("指标看板");
  });

  it("缺省字段：title 用目录名，showOnSkillUse 显式为 true，无 ui/metrics/commands", async () => {
    const dir = join(panelRoot, "minimal-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "panel.json"), JSON.stringify({ version: 1 }));
    await expect(readSkillPanel(dir, [panelRoot])).resolves.toEqual({
      dir,
      manifest: { version: 1, title: "minimal-skill", showOnSkillUse: true },
    });
  });

  it("无 panel.json 返回 null", async () => {
    const dir = join(panelRoot, "no-panel");
    mkdirSync(dir, { recursive: true });
    await expect(readSkillPanel(dir, [panelRoot])).resolves.toBeNull();
  });

  it("坏 JSON 或非对象返回 null", async () => {
    const broken = writePanelDir("bad-json", '{ "version": 1, ');
    await expect(readSkillPanel(broken, [panelRoot])).resolves.toBeNull();
    const arrayJson = writePanelDir("array-json", [1, 2, 3]);
    await expect(readSkillPanel(arrayJson, [panelRoot])).resolves.toBeNull();
  });

  it("version 不是 1 返回 null", async () => {
    const v2 = writePanelDir("v2", { version: 2, title: "x" });
    await expect(readSkillPanel(v2, [panelRoot])).resolves.toBeNull();
    const strVersion = writePanelDir("v-str", { version: "1", title: "x" });
    await expect(readSkillPanel(strVersion, [panelRoot])).resolves.toBeNull();
  });

  it("panel.json 超过 64KB 返回 null", async () => {
    const dir = writePanelDir("too-large", { version: 1, title: "x", pad: "y".repeat(70 * 1024) });
    await expect(readSkillPanel(dir, [panelRoot])).resolves.toBeNull();
  });

  it("metrics 非法值丢弃、去重、顺序按声明；全非法时省略字段", async () => {
    const dir = writePanelDir("metrics", {
      version: 1,
      metrics: ["cacheHit", "nope", "rounds", "cacheHit", null],
    });
    const info = await readSkillPanel(dir, [panelRoot]);
    expect(info?.manifest.metrics).toEqual(["cacheHit", "rounds"]);

    const invalid = writePanelDir("metrics-invalid", { version: 1, metrics: ["nope", 1, {}] });
    const noMetrics = await readSkillPanel(invalid, [panelRoot]);
    expect(noMetrics?.manifest).not.toHaveProperty("metrics");
  });

  it("commands 只留 toggle；全非法时省略字段", async () => {
    const dir = writePanelDir("commands", {
      version: 1,
      commands: { " ": "toggle", run: "run", open: "toggle" },
    });
    const info = await readSkillPanel(dir, [panelRoot]);
    expect(info?.manifest.commands).toEqual({ open: "toggle" });

    const invalid = writePanelDir("commands-invalid", { version: 1, commands: { a: "run" } });
    const noCommands = await readSkillPanel(invalid, [panelRoot]);
    expect(noCommands?.manifest).not.toHaveProperty("commands");
  });

  it("ui 为越权相对路径或绝对路径时当作没有 ui", async () => {
    const escape = writePanelDir("ui-escape", { version: 1, ui: "../x.html" });
    writeFileSync(join(panelRoot, "x.html"), "<h1>外部</h1>");
    const escapeInfo = await readSkillPanel(escape, [panelRoot]);
    expect(escapeInfo?.manifest).not.toHaveProperty("ui");
    expect(escapeInfo?.html).toBeUndefined();

    const absolute = writePanelDir("ui-absolute", {
      version: 1,
      ui: join(panelRoot, "x.html"),
    });
    const absInfo = await readSkillPanel(absolute, [panelRoot]);
    expect(absInfo?.manifest).not.toHaveProperty("ui");
    expect(absInfo?.html).toBeUndefined();
  });

  it("ui 指向不存在的文件：manifest 保留 ui，但没有 html", async () => {
    const dir = writePanelDir("ui-missing", { version: 1, ui: "ui/missing.html" });
    const info = await readSkillPanel(dir, [panelRoot]);
    expect(info?.manifest.ui).toBe("ui/missing.html");
    expect(info?.html).toBeUndefined();
  });

  it("目录不在白名单（或不存在）返回 null", async () => {
    const dir = writePanelDir("outside", { version: 1 });
    await expect(readSkillPanel(dir, [])).resolves.toBeNull();
    await expect(readSkillPanel(join(tmpdir(), "zen-no-such-dir-xyz"), [panelRoot])).resolves.toBeNull();
  });
});
