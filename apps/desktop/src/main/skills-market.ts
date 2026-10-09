import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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

/** 带超时的 fetch：上游不可达时中止请求，避免 IPC 永远 pending 导致刷新按钮一直转圈 */
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function expandHome(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return join(homedir(), path.slice(1).replace(/^\//, "") || "");
  }
  return path;
}

/** skills.sh 搜索结果短 TTL 缓存：刷新/批量检测重复查询直接复用，减少上游请求 */
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const searchCache = new Map<string, { at: number; items: SkillMarketHit[] }>();

/** skills.sh 搜索串行闸：批量检测并发查询时逐个放行，避免同时打 API 触发限流 */
let searchQueue: Promise<unknown> = Promise.resolve();

/** 拉取一次 skills.sh 搜索结果：429 限流时按 Retry-After / 指数退避重试 */
async function fetchMarketplaceItems(query: string): Promise<SkillMarketHit[]> {
  const q = encodeURIComponent(query.trim() || "skills");
  const url = `https://skills.sh/api/search?q=${q}`;
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "User-Agent": "Zen-Desktop/0.1" },
    });
    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
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
}

/** skills.sh 搜索：结果走短 TTL 缓存，网络请求经串行闸逐个放行 */
async function searchMarketplace(query: string): Promise<SkillMarketHit[]> {
  const key = query.trim() || "skills";
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
    return cached.items;
  }
  const run = searchQueue.then(() => fetchMarketplaceItems(key));
  searchQueue = run.catch(() => {});
  const items = await run;
  searchCache.set(key, { at: Date.now(), items });
  return items;
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

/** skills CLI 全局锁文件条目：记录安装来源与仓库内 SKILL.md 的精确路径 */
interface SkillLockEntry {
  source: string;
  sourceType?: string;
  skillPath?: string;
}

/**
 * 读取 skills CLI 的全局锁文件（~/.agents/.skill-lock.json）。
 * 锁里有每个 CLI 安装技能的 source（owner/repo）与 skillPath（仓库内精确路径），
 * 是定位上游的权威来源：仓库布局千差万别（根目录 / skills/<id> / skills/<分类>/<id> / 隐藏目录），
 * 依赖猜路径必然漏。本地/手工拷贝的技能不在锁里，回退 origin 与跳过。
 */
async function readSkillLockMap(): Promise<Map<string, SkillLockEntry>> {
  const map = new Map<string, SkillLockEntry>();
  try {
    const raw = await readFile(join(homedir(), ".agents", ".skill-lock.json"), "utf8");
    const data = JSON.parse(raw) as {
      skills?: Record<string, { source?: string; sourceType?: string; skillPath?: string }>;
    };
    for (const [name, entry] of Object.entries(data.skills ?? {})) {
      if (entry?.source) {
        map.set(name, {
          source: entry.source,
          sourceType: entry.sourceType,
          skillPath: entry.skillPath,
        });
      }
    }
  } catch {
    // 无锁文件（技能非 skills CLI 安装）
  }
  return map;
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

/**
 * 拉取上游 SKILL.md（用于内容哈希比对）。
 * skillPath 来自 skills CLI 锁文件，是仓库内精确路径——仓库布局千差万别
 * （根目录 / skills/<id> / skills/<分类>/<id> / .claude/skills/<id> 等），猜路径必漏。
 * 无 skillPath 时按常见布局逐个试探；ref 优先 HEAD（raw 支持，默认分支），回退 main/master。
 */
async function fetchRemoteSkillMd(
  source: string,
  skillId: string,
  skillPath?: string,
): Promise<string | null> {
  const repo = source.replace(/^github\//, "");
  const parts = repo.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const [owner, repoName] = parts;
  const refs = ["HEAD", "main", "master"];
  const paths = skillPath
    ? [skillPath]
    : [
        "SKILL.md",
        `${skillId}/SKILL.md`,
        `skills/${skillId}/SKILL.md`,
        `.claude/skills/${skillId}/SKILL.md`,
        `.agents/skills/${skillId}/SKILL.md`,
        `${skillId}/skill.md`,
      ];
  for (const ref of refs) {
    for (const path of paths) {
      const url = `https://raw.githubusercontent.com/${owner}/${repoName}/${ref}/${path}`;
      try {
        const response = await fetchWithTimeout(url, {
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

/** 上游定位结果：source（owner/repo）+ 仓库内 SKILL.md 精确路径 */
interface UpstreamRef {
  source: string;
  skillPath?: string;
}

/**
 * 定位技能的上游来源，优先级：skills CLI 锁文件（含精确 skillPath）> .zen-origin.json。
 * 锁文件是 skills CLI 安装时写入的权威记录，能覆盖任意仓库布局；
 * origin 是 Zen 市场安装的兜底记录（无 skillPath，靠候选路径探测）。
 * 无锁条目时若 skills.sh 搜索也不可用，则认为无上游。
 */
async function resolveUpstream(
  skill: SkillSummary,
  lock: Map<string, SkillLockEntry>,
): Promise<UpstreamRef | null> {
  const entry = lock.get(skill.name);
  if (entry?.source) {
    return { source: entry.source, skillPath: entry.skillPath };
  }
  const origin = await readSkillOrigin(skill.dir);
  if (origin?.source) {
    return { source: origin.source };
  }
  return null;
}

/**
 * 更新检测：git 仓库比对提交落后；其余按上游 SKILL.md 内容哈希比对。
 * 上游定位走 resolveUpstream（锁文件/origin），不再依赖 skills.sh 搜索兜底——
 * 搜索既触发限流（HTTP 429），又可能把同名技能匹配到错误仓库。
 * 比不到内容时报「跳过」而非「可更新」，避免误报。
 */
async function checkMarketUpdate(
  skill: SkillSummary,
  lock: Map<string, SkillLockEntry>,
): Promise<SkillUpdateInfo> {
  const base: SkillUpdateInfo = {
    id: skill.id,
    name: skill.name,
    dir: skill.dir,
    hasUpdate: false,
    via: "market",
    note: "已是最新",
  };
  const upstream = await resolveUpstream(skill, lock);
  if (!upstream) {
    return { ...base, via: "none", note: "无上游来源记录（本地技能），跳过比对" };
  }
  const remote = await fetchRemoteSkillMd(upstream.source, skill.name, upstream.skillPath);
  if (remote == null) {
    return {
      ...base,
      via: "none",
      note: `无法获取上游 SKILL.md（${upstream.source}），跳过比对`,
    };
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

async function checkOneSkillUpdate(
  skill: SkillSummary,
  lock: Map<string, SkillLockEntry>,
): Promise<SkillUpdateInfo> {
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
  return checkMarketUpdate(skill, lock);
}

async function marketCheckUpdates(skills: SkillSummary[]): Promise<SkillUpdateCheckResult> {
  const list = Array.isArray(skills) ? skills.filter((item) => item?.id && item?.dir) : [];
  if (!list.length) {
    return { ok: true, items: [] };
  }
  const lock = await readSkillLockMap();
  // 有限并发检测（每个技能含 git fetch / 上游请求，串行在技能多时可达数分钟）
  const CONCURRENCY = 6;
  const items: SkillUpdateInfo[] = new Array(list.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      const skill = list[index];
      if (!skill) {
        continue;
      }
      try {
        items[index] = await checkOneSkillUpdate(skill, lock);
      } catch (error) {
        // 单技能检测失败不阻断整体，IPC 仍需 resolve
        items[index] = {
          id: skill.id,
          name: skill.name,
          dir: skill.dir,
          hasUpdate: false,
          via: "none",
          note: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    return { ok: true, items };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 覆盖安装到技能实际所在目录。
 * skills CLI `add --global` 固定装到 ~/.claude/skills，但技能可能位于 ~/.agents/skills
 * 或用户自定义路径——直接覆盖原目录才能真正生效（否则更新只落到别处，界面上毫无变化）。
 */
async function installToSkillDir(
  hit: SkillMarketHit,
  skillDir: string,
): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const result = await installMarketSkill(hit);
  if (!result.ok || !result.dir) {
    return result;
  }
  const installedDir = result.dir;
  if (resolve(installedDir) === resolve(skillDir)) {
    return result;
  }
  // 安装落点与技能实际目录不同：整体替换原目录（cp 是合并语义，上游已删的残留文件不会清掉）
  const staging = `${skillDir}.zen-update`;
  try {
    await rm(staging, { recursive: true, force: true });
    await cp(installedDir, staging, { recursive: true, force: true });
    await writeSkillOrigin(staging, hit);
    await rm(skillDir, { recursive: true, force: true });
    await rename(staging, skillDir);
    await rm(installedDir, { recursive: true, force: true });
    return { ok: true, dir: skillDir };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    return {
      ok: true,
      dir: installedDir,
      error: `已更新 ${installedDir}，但同步回 ${skillDir} 失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * 更新：git 仓库走 pull --ff-only；市场技能走覆盖安装。
 * 上游定位与检测同源（锁文件/origin），安装后同步回技能实际目录。
 */
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
  const lock = await readSkillLockMap();
  const upstream = await resolveUpstream(skill, lock);
  if (!upstream) {
    return { ok: false, error: "无上游来源记录，无法更新（本地技能请手动维护）" };
  }
  const hit: SkillMarketHit = {
    id: `${upstream.source}/${skill.name}`,
    skillId: skill.name,
    name: skill.name,
    source: upstream.source,
    installs: 0,
  };
  return installToSkillDir(hit, dir);
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
