import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { ipcMain } from "electron";

import { zenSkillsRoot } from "./zen-dir";

import type { SkillMarketHit, SkillSummary } from "@zen/shared";

const execFileAsync = promisify(execFile);

function expandHome(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return join(homedir(), path.slice(1).replace(/^\//, "") || "");
  }
  return path;
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

/**
 * 定位 npx 可执行文件：GUI 启动（Finder/Dock/双击）时 PATH 通常只有系统目录，
 * 不含用户 Node（nvm / volta / n / Homebrew 等），需按平台探测常见安装位置。
 * 返回可执行文件与补齐后的 env（PATH 前插该目录，保证 npx 能找到 node）。
 */
async function resolveNpxInvocation(): Promise<{
  cmd: string;
  env: NodeJS.ProcessEnv;
  shell: boolean;
} | null> {
  const isWin = process.platform === "win32";
  const npxName = isWin ? "npx.cmd" : "npx";
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  // 跨平台常见 Node 安装目录（探测到即并入搜索与 PATH）
  const extraDirs = isWin
    ? [
        process.env.APPDATA ? join(process.env.APPDATA, "npm") : "",
        process.env.ProgramFiles ? join(process.env.ProgramFiles, "nodejs") : "",
        join(homedir(), ".volta", "bin"),
        join(homedir(), "scoop", "apps", "nodejs", "current"),
      ].filter(Boolean)
    : [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join(homedir(), "n", "bin"),
        join(homedir(), ".volta", "bin"),
        join(homedir(), ".local", "bin"),
        join(homedir(), ".asdf", "shims"),
      ];

  // nvm：取版本号最高的已安装 Node（macOS/Linux）
  if (!isWin) {
    const nvmRoot = join(homedir(), ".nvm", "versions", "node");
    try {
      const versions = await readdir(nvmRoot);
      const latest = versions
        .filter((name) => /^v?\d+(\.\d+)*$/.test(name))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .at(-1);
      if (latest) {
        extraDirs.push(join(nvmRoot, latest, "bin"));
      }
    } catch {
      // 无 nvm，忽略
    }
  }

  for (const dir of [...extraDirs, ...pathDirs]) {
    const candidate = join(dir, npxName);
    try {
      await stat(candidate);
      return {
        cmd: candidate,
        env: { ...process.env, PATH: [dir, ...pathDirs].join(delimiter) },
        shell: isWin, // Windows 上 .cmd 需要 shell 才能被 spawn
      };
    } catch {
      // 继续探测
    }
  }
  return null;
}

/** execFile 错误转可读信息：剥 ANSI、取 stderr 尾部（CLI 的失败原因都在 stderr） */
function installErrorMessage(error: unknown): string {
  const err = error as { message?: string; stderr?: string | Buffer; killed?: boolean };
  if (err?.killed) {
    return "安装超时：skills CLI 长时间未响应，请检查网络后重试";
  }
  const raw = typeof err?.stderr === "string" ? err.stderr : (err?.stderr?.toString("utf8") ?? "");
  const tail = raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join("；");
  return tail || err?.message || "安装失败";
}

/**
 * 安装：npx skills CLI（--global 装到 ~/.claude/skills，--copy 落实体文件便于卸载）。
 * 注意 CLI 的包参数是 owner/repo，技能名用 --skill 指定；缺 --yes 会在非 TTY 下挂起等待输入。
 */
async function installMarketSkill(
  hit: SkillMarketHit,
): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const npx = await resolveNpxInvocation();
  if (!npx) {
    return {
      ok: false,
      error: "未找到 npx（Node.js）。请安装 Node.js 后重启 Zen 再试。",
    };
  }
  try {
    await mkdir(zenSkillsRoot(), { recursive: true });
    await execFileAsync(
      npx.cmd,
      [
        "-y",
        "skills",
        "add",
        hit.source,
        "--skill",
        hit.skillId,
        "--agent",
        "claude-code",
        "--global",
        "--copy",
        "--yes",
      ],
      {
        timeout: 180_000,
        env: npx.env,
        windowsHide: true,
        shell: npx.shell,
      },
    );
  } catch (error) {
    return { ok: false, error: installErrorMessage(error) };
  }
  // skills CLI --global 固定安装到 ~/.claude/skills（与 listSkills 的兼容目录一致）
  const installedDir = join(homedir(), ".claude", "skills", hit.skillId);
  try {
    await stat(join(installedDir, "SKILL.md"));
    return { ok: true, dir: installedDir };
  } catch {
    return { ok: false, error: "安装完成但未找到 SKILL.md，请查看 skills CLI 输出" };
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
    if (!hit?.id || !hit?.skillId || !hit?.source) {
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

  ipcMain.handle("skills:user-root", () => zenSkillsRoot());
}
