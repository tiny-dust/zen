import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ipcMain } from "electron";

import { listSkills } from "@zen/skills";

import { completeOnceStream } from "./model-api";
import { loadAgentSettings, zenSkillsRoot } from "./zen-dir";

import type { SkillMarketHit, SkillSummary } from "@zen/shared";

const execFileAsync = promisify(execFile);

export interface SkillAnalyzeRequest {
  providerId: string;
  modelId: string;
}

function expandHome(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return join(homedir(), path.slice(1).replace(/^\//, "") || "");
  }
  return path;
}

async function readSkillBodies(skills: SkillSummary[]): Promise<string> {
  const chunks: string[] = [];
  for (const skill of skills) {
    let body = "";
    try {
      const file = join(skill.dir, "SKILL.md");
      const raw = await readFile(file, "utf8");
      body = raw.slice(0, 2400);
    } catch {
      body = "(无法读取 SKILL.md)";
    }
    chunks.push(`## ${skill.name} (id=${skill.id}, dir=${skill.dir})\n${body}`);
  }
  return chunks.join("\n\n");
}

async function searchMarketplace(query: string): Promise<SkillMarketHit[]> {
  const q = encodeURIComponent(query.trim() || "skills");
  const url = `https://skills.sh/api/search?q=${q}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Zen-Desktop/0.1" },
  });
  if (!response.ok) {
    throw new Error(`skills.sh 搜索失败 HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    skills?: Array<{
      id: string;
      skillId: string;
      name: string;
      installs?: number;
      source: string;
    }>;
  };
  return (data.skills ?? []).slice(0, 40).map((item) => ({
    id: item.id,
    skillId: item.skillId,
    name: item.name,
    source: item.source,
    installs: item.installs ?? 0,
  }));
}

/** 安装：优先 npx skills add，并确保结果落在 ~/.zen/skills 下可见 */
async function installMarketSkill(hit: SkillMarketHit): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const target = join(zenSkillsRoot(), hit.skillId);
  await mkdir(zenSkillsRoot(), { recursive: true });
  try {
    // skills CLI 会装到 agent 目录；Zen 额外在 ~/.zen/skills 建同名技能目录副本入口
    await execFileAsync(
      "npx",
      ["-y", "skills", "add", hit.id, "--agent", "claude-code"],
      {
        timeout: 120_000,
        env: { ...process.env, CI: "1" },
        windowsHide: true,
      },
    );
    // 若 CLI 装到了 ~/.claude/skills 或 ~/.agents/skills，复制到 Zen 技能根
    const candidates = [
      join(homedir(), ".claude", "skills", hit.skillId),
      join(homedir(), ".agents", "skills", hit.skillId),
      join(homedir(), ".codex", "skills", hit.skillId),
    ];
    let installedDir = "";
    for (const dir of candidates) {
      try {
        await stat(join(dir, "SKILL.md"));
        installedDir = dir;
        break;
      } catch {
        // continue
      }
    }
    if (installedDir && installedDir !== target) {
      await execFileAsync("cp", ["-R", installedDir, target], { windowsHide: true }).catch(
        async () => {
          // Windows 无 cp 时退回 Node 复制
          const { cp } = await import("node:fs/promises");
          await cp(installedDir, target, { recursive: true });
        },
      );
    }
    try {
      await stat(join(target, "SKILL.md"));
      return { ok: true, dir: target };
    } catch {
      return installedDir
        ? { ok: true, dir: installedDir }
        : { ok: false, error: "安装完成但未找到 SKILL.md，请检查 skills CLI 输出" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function uninstallSkill(skill: SkillSummary): Promise<{ ok: boolean; error?: string }> {
  const dir = expandHome(skill.dir);
  const zenRoot = zenSkillsRoot();
  // 仅允许卸载位于用户技能目录下的技能，系统内置不动
  const allowed = [zenRoot, join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")];
  const underAllowed = allowed.some((root) => dir.startsWith(root));
  if (!underAllowed) {
    return { ok: false, error: "该技能不在可卸载的用户技能目录中" };
  }
  try {
    await rm(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function analyzeSkills(
  req: SkillAnalyzeRequest,
  onDelta: (text: string) => void,
): Promise<{ ok: boolean; report?: string; error?: string }> {
  const settings = await loadAgentSettings();
  const skills = await listSkills(settings.skillExtraPaths);
  if (!skills.length) {
    return { ok: false, error: "本地没有可分析的技能" };
  }
  const bodies = await readSkillBodies(skills);
  const prompt = `你是 Zen 的技能冲突分析器。下面是本机已安装技能的清单与 SKILL.md 摘要。

请分析：
1. 功能重叠 / 触发条件冲突
2. 可能抢同一条用户指令的技能
3. 工作流矛盾（例如同时要求 TDD 与直接实现）
4. 给出保留/禁用/合并建议

输出用中文 Markdown：先给结论表，再给逐条建议。不要编造不存在的技能。

${bodies}`;
  try {
    // 流式补全：增量实时推给渲染层（折叠面板内边生成边展示），避免
    // reasoning 模型 stream:false 全量缓冲把补全拖到超时
    const report = await completeOnceStream(
      prompt,
      {
        system:
          "你是严谨的本地技能审计助手。只依据提供的技能内容分析，输出可执行建议，不编造。",
        maxTokens: 4096,
        timeoutMs: 180_000,
        providerId: req.providerId,
        modelId: req.modelId,
      },
      onDelta,
    );
    if (!report.trim()) {
      return { ok: false, error: "模型未返回分析结果" };
    }
    return { ok: true, report };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerSkillsMarketIpc(): void {
  ipcMain.handle("skills:market-search", async (_e, query: string) => {
    try {
      const items = await searchMarketplace(typeof query === "string" ? query : "");
      return { ok: true, items };
    } catch (error) {
      return {
        ok: false,
        items: [] as SkillMarketHit[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("skills:market-install", async (_e, hit: SkillMarketHit) => {
    if (!hit?.id || !hit?.skillId) {
      return { ok: false, error: "无效的技能条目" };
    }
    return installMarketSkill(hit);
  });

  ipcMain.handle("skills:uninstall", async (_e, skill: SkillSummary) => {
    if (!skill?.dir) {
      return { ok: false, error: "无效的技能" };
    }
    return uninstallSkill(skill);
  });

  // 流式分析：增量经 skills:analyze-event 定向推给发起方，invoke 返回值仍为最终结果
  ipcMain.handle("skills:analyze", async (event, req: SkillAnalyzeRequest) => {
    if (!req?.providerId || !req?.modelId) {
      return { ok: false, error: "请先选择分析所用模型" };
    }
    const sender = event.sender;
    return analyzeSkills(req, (text) => {
      if (!sender.isDestroyed()) {
        sender.send("skills:analyze-event", { text });
      }
    });
  });

  ipcMain.handle("skills:user-root", () => zenSkillsRoot());
}
