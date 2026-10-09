import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  home: "",
  // raw.githubusercontent 请求记录（URL -> 上游 SKILL.md 内容；缺省 404）
  remoteFiles: new Map<string, string>(),
  fetchLog: [] as string[],
  execLog: [] as string[][],
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => state.home };
});

vi.mock("./zen-dir", () => ({
  zenSkillsRoot: () => join(state.home, ".zen", "skills"),
}));

vi.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    state.execLog.push([cmd, ...args]);
    if (cmd === "git") {
      cb(new Error("not a git repository"), "", "fatal: not a git repository");
      return;
    }
    // npx skills add：模拟装到 ~/.claude/skills/<skillId>
    const skillFlag = args.indexOf("--skill");
    const skillId = (skillFlag >= 0 ? args[skillFlag + 1] : "") ?? "";
    const installed = join(state.home, ".claude", "skills", skillId);
    mkdir(installed, { recursive: true })
      .then(() => writeFile(join(installed, "SKILL.md"), state.remoteFiles.get(skillId) ?? "installed\n", "utf8"))
      .then(() => cb(null, "", ""))
      .catch((error: Error) => cb(error, "", error.message));
  },
}));

import { registerSkillsMarketIpc } from "./skills-market";

import type { SkillSummary } from "@zen/shared";

function handler(channel: string) {
  const fn = state.handlers.get(channel);
  if (!fn) {
    throw new Error(`handler ${channel} not registered`);
  }
  return fn;
}

function makeSkill(name: string, dir: string): SkillSummary {
  return {
    id: dir,
    name,
    description: "",
    dir,
    source: "user",
    removable: true,
    disabled: false,
  };
}

async function writeLocalSkill(dir: string, body: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body, "utf8");
}

describe("skills-market", () => {
  beforeEach(async () => {
    state.handlers.clear();
    state.fetchLog.length = 0;
    state.execLog.length = 0;
    state.remoteFiles.clear();
    state.home = await mkdtemp(join(tmpdir(), "zen-skills-market-"));
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      state.fetchLog.push(url);
      if (url.includes("skills.sh")) {
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      }
      const hit = [...state.remoteFiles.entries()].find(([key]) => url.includes(key));
      if (hit && url.includes("raw.githubusercontent.com")) {
        return new Response(hit[1], { status: 200 });
      }
      return new Response("404: Not Found", { status: 404 });
    });
    registerSkillsMarketIpc();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(state.home, { recursive: true, force: true });
  });

  it("按锁文件 skillPath 精确定位上游（任意仓库布局都能比对）", async () => {
    // mattpocock/skills 布局：skills/engineering/<id>/SKILL.md —— 旧的三个猜路径全部 404
    await mkdir(join(state.home, ".agents"), { recursive: true });
    await writeFile(
      join(state.home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "ask-matt": {
            source: "mattpocock/skills",
            sourceType: "github",
            skillPath: "skills/engineering/ask-matt/SKILL.md",
          },
        },
      }),
      "utf8",
    );
    const dir = join(state.home, ".agents", "skills", "ask-matt");
    await writeLocalSkill(dir, "local version\n");
    const key = "raw.githubusercontent.com/mattpocock/skills/";
    state.remoteFiles.set(key, "remote version\n");

    const result = (await handler("skills:market-check-updates")({}, [
      makeSkill("ask-matt", dir),
    ])) as { ok: boolean; items: Array<{ hasUpdate: boolean; note?: string }> };

    expect(result.ok).toBe(true);
    expect(result.items[0]?.hasUpdate).toBe(true);
    // 必须按 skillPath 拉取，而不是猜路径
    expect(
      state.fetchLog.some((url) =>
        url.includes("mattpocock/skills/HEAD/skills/engineering/ask-matt/SKILL.md"),
      ),
    ).toBe(true);
    // 更新检测不应打 skills.sh（限流根因）
    expect(state.fetchLog.some((url) => url.includes("skills.sh"))).toBe(false);
  });

  it("无上游来源记录的本地技能跳过比对，且不打 skills.sh", async () => {
    const dir = join(state.home, ".zen", "skills", "coder");
    await writeLocalSkill(dir, "my local skill\n");

    const result = (await handler("skills:market-check-updates")({}, [
      makeSkill("coder", dir),
    ])) as { ok: boolean; items: Array<{ hasUpdate: boolean; via: string; note?: string }> };

    expect(result.items[0]?.hasUpdate).toBe(false);
    expect(result.items[0]?.via).toBe("none");
    expect(result.items[0]?.note).toContain("无上游来源记录");
    expect(state.fetchLog.some((url) => url.includes("skills.sh"))).toBe(false);
  });

  it("内容与上游一致时报已是最新", async () => {
    await mkdir(join(state.home, ".agents"), { recursive: true });
    await writeFile(
      join(state.home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "web-design-guidelines": {
            source: "vercel-labs/agent-skills",
            sourceType: "github",
            skillPath: "skills/web-design-guidelines/SKILL.md",
          },
        },
      }),
      "utf8",
    );
    const dir = join(state.home, ".claude", "skills", "web-design-guidelines");
    await writeLocalSkill(dir, "same content\n");
    const key = "raw.githubusercontent.com/vercel-labs/agent-skills/";
    state.remoteFiles.set(key, "same content\n");

    const result = (await handler("skills:market-check-updates")({}, [
      makeSkill("web-design-guidelines", dir),
    ])) as { ok: boolean; items: Array<{ hasUpdate: boolean; note?: string }> };

    expect(result.items[0]?.hasUpdate).toBe(false);
    expect(result.items[0]?.note).toBe("已是最新");
  });

  it("更新落盘到技能实际目录（~/.agents 等），而非 CLI 默认的 ~/.claude", async () => {
    await mkdir(join(state.home, ".agents"), { recursive: true });
    await writeFile(
      join(state.home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "my-skill": {
            source: "acme/skills",
            sourceType: "github",
            skillPath: "skills/my-skill/SKILL.md",
          },
        },
      }),
      "utf8",
    );
    // 技能实际位于 ~/.agents/skills（CLI add 固定装到 ~/.claude/skills）
    const dir = join(state.home, ".agents", "skills", "my-skill");
    await writeLocalSkill(dir, "old local\n");
    await writeFile(join(dir, "stale-extra.md"), "should be gone after replace\n", "utf8");
    // mock 的 execFile 会把 remoteFiles[skillId] 写为安装内容
    state.remoteFiles.set("my-skill", "fresh upstream\n");

    const result = (await handler("skills:market-update")({}, makeSkill("my-skill", dir))) as {
      ok: boolean;
      dir?: string;
      error?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.dir).toBe(dir);
    // 原目录内容被整体替换为上游版本
    expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe("fresh upstream\n");
    // 上游已删/本地多余文件不残留（整体替换而非合并）
    await expect(readFile(join(dir, "stale-extra.md"), "utf8")).rejects.toThrow();
    // CLI 默认落点不应留下影子副本
    await expect(
      readFile(join(state.home, ".claude", "skills", "my-skill", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("无上游来源的技能更新时报错，不静默成功", async () => {
    const dir = join(state.home, ".zen", "skills", "local-only");
    await writeLocalSkill(dir, "local\n");

    const result = (await handler("skills:market-update")({}, makeSkill("local-only", dir))) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("无上游来源记录");
  });
});
