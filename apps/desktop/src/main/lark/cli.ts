import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * lark-cli 可执行文件定位（飞书桥接前置条件）。
 * 跨平台铁律（AGENTS.md）：macOS / Linux / Windows 三方都要能找到；
 * 任何一步探测失败都静默跳过，全部失败返回 null，由调用方降级
 * （飞书桥接进入 error 态，不影响 zen 其它功能）。
 */

let cachedPath: string | null | undefined;

/** 探测结果缓存（含 null：找不到也缓存，避免每条指令重复全盘扫描） */
export function resolveLarkCliPath(): string | null {
  if (cachedPath !== undefined) {
    return cachedPath;
  }
  cachedPath = findLarkCliPath();
  return cachedPath;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    // Windows 上 X_OK 语义弱化为存在性检查，可接受（.cmd 由 cmd 解释执行）
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH 逐目录扫描；可执行名按平台区分（Windows 是 npm 垫片 .cmd / .exe） */
function findOnPath(): string | null {
  const pathEnv = process.env["PATH"] ?? "";
  const names = process.platform === "win32" ? ["lark-cli.cmd", "lark-cli.exe"] : ["lark-cli"];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/** `npm prefix -g`（npm 不在 PATH / 超时等情况返回 null，不抛错） */
function npmGlobalPrefix(): string | null {
  try {
    const stdout = execFileSync("npm", ["prefix", "-g"], {
      timeout: 5000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const prefix = stdout.trim();
    return prefix || null;
  } catch {
    return null;
  }
}

/** npm 全局安装布局下的候选路径 */
function npmGlobalCliCandidates(): string[] {
  const prefix = npmGlobalPrefix();
  if (!prefix) {
    return [];
  }
  if (process.platform === "win32") {
    // Windows：npm 全局 bin 就在 prefix 根目录（%APPDATA%\npm）
    return [join(prefix, "lark-cli.cmd"), join(prefix, "lark-cli.exe")];
  }
  // macOS/Linux：包内真实入口 + npm 在 prefix/bin 建的软链，两者都试
  return [
    join(prefix, "lib", "node_modules", "@larksuite", "cli", "bin", "lark-cli"),
    join(prefix, "bin", "lark-cli"),
  ];
}

function compareVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * macOS/Linux 专属：vite-plus 自带的多版本 node 运行时目录，npm 全局包装在
 * <version>/lib/node_modules 下。版本目录随 node 运行时升级变化（如 24.18.0 →
 * 24.21.0），必须动态扫描，禁止写死具体版本号。
 */
function latestVitePlusCli(): string | null {
  if (process.platform === "win32") {
    return null;
  }
  const base = join(homedir(), ".vite-plus", "js_runtime", "node");
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  const versions = entries.filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort(compareVersionDesc);
  for (const version of versions) {
    const candidate = join(
      base,
      version,
      "lib",
      "node_modules",
      "@larksuite",
      "cli",
      "bin",
      "lark-cli",
    );
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findLarkCliPath(): string | null {
  // 1. PATH 上的 lark-cli（用户自装的全局/局部安装，最常见）
  const onPath = findOnPath();
  if (onPath) {
    return onPath;
  }

  if (process.platform === "win32") {
    // Windows：%APPDATA%\npm 是 npm 全局 bin 的固定位置
    const appData = process.env["APPDATA"];
    if (appData) {
      const candidate = join(appData, "npm", "lark-cli.cmd");
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    return npmGlobalCliCandidates().find(isExecutableFile) ?? null;
  }

  // macOS / Linux：~/.local/bin（用户手装二进制）→ vite-plus 运行时 → npm prefix -g
  const localBin = join(homedir(), ".local", "bin", "lark-cli");
  if (isExecutableFile(localBin)) {
    return localBin;
  }
  const vitePlus = latestVitePlusCli();
  if (vitePlus) {
    return vitePlus;
  }
  return npmGlobalCliCandidates().find(isExecutableFile) ?? null;
}
