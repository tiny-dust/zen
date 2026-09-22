import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { ipcMain } from "electron";

import { zenSkillsRoot } from "./zen-dir";

import type {
  SkillMarketHit,
  SkillSummary,
  SkillUpdateCheckResult,
  SkillUpdateInfo,
} from "@zen/shared";

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
    await writeSkillOrigin(installedDir, hit);
    return { ok: true, dir: installedDir };
  } catch {
    return { ok: false, error: "安装完成但未找到 SKILL.md，请查看 skills CLI 输出" };
  }
}

/** 安装来源元数据：便于刷新时按 skills.sh / git 上游比对是否有新版本 */
const ORIGIN_FILE = ".zen-origin.json";

async function readSkillBodyHash(dir: string): Promise<string> {
  try {
    const raw = await readFile(join(dir, "SKILL.md"), "utf8");
    // 稳定哈希：剥掉 frontmatter 外空白差异
    let h = 0;
    const text = raw.replace(/\r\n/g, "\n").trim();
    for (let i = 0; i < text.length; i += 1) {
      h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    }
    return String(h);
  } catch {
    return "";
  }
}

async function writeSkillOrigin(dir: string, hit: SkillMarketHit): Promise<void> {
  try {
    await writeFile(
      join(dir, ORIGIN_FILE),
      JSON.stringify(
        {
          source: hit.source,
          skillId: hit.skillId,
          name: hit.name,
          installedAt: Date.now(),
          bodyHash: await readSkillBodyHash(dir),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // 元数据写失败不阻断安装
  }
}

async function readSkillOrigin(
  dir: string,
): Promise<{ source: string; skillId: string; name?: string; bodyHash?: string } | null> {
  try {
    const raw = await readFile(join(dir, ORIGIN_FILE), "utf8");
    const data = JSON.parse(raw) as {
      source?: string;
      skillId?: string;
      name?: string;
      bodyHash?: string;
    };
    if (typeof data.source === "string" && typeof data.skillId === "string") {
      return {
        source: data.source,
        skillId: data.skillId,
        name: data.name,
        bodyHash: data.bodyHash,
      };
    }
  } catch {
    // 无元数据
  }
  return null;
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
      windowsHide: true,
      timeout: 8_000,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** git 仓库：fetch 后比对 HEAD..@{u}，落后提交数 > 0 即可更新 */
async function checkGitUpdate(dir: string): Promise<SkillUpdateInfo | null> {
  if (!(await isGitWorkTree(dir))) {
    return null;
  }
  try {
    await execFileAsync("git", ["-C", dir, "fetch", "--quiet"], {
      windowsHide: true,
      timeout: 30_000,
    });
    const { stdout } = await execFileAsync("git", ["-C", dir, "rev-list", "--count", "HEAD..@{u}"], {
      windowsHide: true,
      timeout: 8_000,
    });
    const behind = Number(stdout.trim()) || 0;
    return {
      id: dir,
      name: "",
      dir,
      hasUpdate: behind > 0,
      via: "git",
      behind,
      note: behind > 0 ? `上游有 ${behind} 个新提交` : "已是最新",
    };
  } catch {
    // 无上游跟踪 / fetch 失败
    return {
      id: dir,
      name: "",
      dir,
      hasUpdate: false,
      via: "git",
      note: "无法比对 git 上游",
    };
  }
}

/** 从 skills.sh source（owner/repo）+ skillId 试拉上游 SKILL.md，用于内容哈希比对 */
async function fetchRemoteSkillMd(
  source: string,
  skillId: string,
): Promise<string | null> {
  const repo = source.replace(/^github\//, "");
  const parts = repo.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const [owner, repoName] = parts;
  const branches = ["main", "master"];
  const paths = [
    `${skillId}/SKILL.md`,
    `skills/${skillId}/SKILL.md`,
    `${skillId}/skill.md`,
  ];
  for (const branch of branches) {
    for (const path of paths) {
      const url = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${path}`;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Zen-Desktop/0.1" },
        });
        if (response.ok) {
          const text = await response.text();
          if (text.trim() && !text.startsWith("404")) {
            return text;
          }
        }
      } catch {
        // 尝试下一个候选路径
      }
    }
  }
  return null;
}

function hashText(text: string): string {
  let h = 0;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < normalized.length; i += 1) {
    h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * skills.sh 市场技能：按安装来源（.zen-origin.json）或 skillId 定位上游，
 * 拉取上游 SKILL.md 与本地内容哈希比对。比不到内容时不报「可更新」。
 */
async function checkMarketUpdate(skill: SkillSummary): Promise<SkillUpdateInfo> {
  const base: SkillUpdateInfo = {
    id: skill.id,
    name: skill.name,
    dir: skill.dir,
    hasUpdate: false,
    via: "market",
    note: "已是最新",
  };
  const origin = await readSkillOrigin(skill.dir);
  let hit: SkillMarketHit | null = null;
  try {
    const query = origin?.skillId || skill.name;
    const items = await searchMarketplace(query);
    hit =
      items.find((item) => item.skillId === (origin?.skillId || skill.name)) ??
      items.find((item) => item.name === skill.name) ??
      null;
  } catch {
    return { ...base, via: "none", note: "无法访问 skills.sh 上游" };
  }
  if (!hit && !origin) {
    return { ...base, via: "none", note: "未在 skills.sh 找到同名上游" };
  }
  const source = origin?.source || hit?.source || "";
  const skillId = origin?.skillId || hit?.skillId || skill.name;
  if (!source) {
    return { ...base, via: "none", note: "缺少上游来源信息" };
  }
  const remote = await fetchRemoteSkillMd(source, skillId);
  if (remote == null) {
    return { ...base, via: "none", note: "无法获取上游 SKILL.md，跳过比对" };
  }
  const remoteHash = hashText(remote);
  const localHash = await readSkillBodyHash(skill.dir);
  if (!localHash) {
    return { ...base, note: "本地 SKILL.md 不可读" };
  }
  if (remoteHash !== localHash) {
    return {
      ...base,
      hasUpdate: true,
      note: "上游内容有变化，可覆盖安装更新",
    };
  }
  return { ...base, note: "已是最新" };
}

async function checkOneSkillUpdate(skill: SkillSummary): Promise<SkillUpdateInfo> {
  if (!skill.removable) {
    return {
      id: skill.id,
      name: skill.name,
      dir: skill.dir,
      hasUpdate: false,
      via: "none",
      note: "非用户技能目录，跳过",
    };
  }
  const gitInfo = await checkGitUpdate(skill.dir);
  if (gitInfo) {
    return { ...gitInfo, id: skill.id, name: skill.name };
  }
  return checkMarketUpdate(skill);
}

async function marketCheckUpdates(skills: SkillSummary[]): Promise<SkillUpdateCheckResult> {
  const list = Array.isArray(skills) ? skills.filter((item) => item?.id && item?.dir) : [];
  if (!list.length) {
    return { ok: true, items: [] };
  }
  try {
    const items: SkillUpdateInfo[] = [];
    for (const skill of list) {
      items.push(await checkOneSkillUpdate(skill));
    }
    return { ok: true, items };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 更新：git 仓库走 pull --ff-only；市场技能走覆盖安装 */
async function marketUpdateSkill(
  skill: SkillSummary,
): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const dir = expandHome(skill.dir);
  if (await isGitWorkTree(dir)) {
    try {
      await execFileAsync("git", ["-C", dir, "pull", "--ff-only"], {
        windowsHide: true,
        timeout: 60_000,
      });
      return { ok: true, dir };
    } catch (error) {
      return { ok: false, error: installErrorMessage(error) };
    }
  }
  const origin = await readSkillOrigin(dir);
  const skillId = origin?.skillId || skill.name;
  const source = origin?.source;
  let hit: SkillMarketHit | null = null;
  if (source) {
    hit = { id: `${source}/${skillId}`, skillId, name: skill.name, source, installs: 0 };
  } else {
    try {
      const items = await searchMarketplace(skillId);
      hit = items.find((item) => item.skillId === skillId) ?? null;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (!hit) {
    return { ok: false, error: "未找到可覆盖安装的市场条目" };
  }
  return installMarketSkill(hit);
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

  ipcMain.handle("skills:market-check-updates", async (_e, skills: SkillSummary[]) => {
    return marketCheckUpdates(skills);
  });

  ipcMain.handle("skills:market-update", async (_e, skill: SkillSummary) => {
    if (!skill?.dir) {
      return { ok: false, error: "无效的技能" };
    }
    return marketUpdateSkill(skill);
  });

  ipcMain.handle("skills:uninstall", async (_e, skill: SkillSummary) => {
    if (!skill?.dir) {
      return { ok: false, error: "无效的技能" };
    }
    return uninstallSkill(skill);
  });

  ipcMain.handle("skills:user-root", () => zenSkillsRoot());
}
