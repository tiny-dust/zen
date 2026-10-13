import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * macOS Swift 小工具编译设施（语音 ASR / OCR / CUA 鼠标共用）。
 * - 源码内置在 TS 里，首次使用时用 swiftc 编译到 ~/.zen/cache/bin/，产物持久化复用；
 * - 二进制名带源码 hash：源码升级后自动重编，不会用到旧产物；
 * - 编译失败（无 swiftc / 编译错误）缓存失败状态，本次会话内不再重试（不反复卡 UI）。
 * 仅 macOS 可用；其它平台 ensureSwiftTool 恒返回 null（安全降级）。
 */

/** Swift 工具二进制名：`<name>-<sourceHash8>`，源码变化即换名重编 */
export function swiftBinaryName(name: string, source: string): string {
  return `${name}-${createHash("sha1").update(source).digest("hex").slice(0, 8)}`;
}

export function swiftToolPaths(cacheRoot: string, name: string, source: string): {
  bin: string;
  src: string;
} {
  const binDir = join(cacheRoot, "bin");
  const srcDir = join(cacheRoot, "src");
  return {
    bin: join(binDir, swiftBinaryName(name, source)),
    src: join(srcDir, `${swiftBinaryName(name, source)}.swift`),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 本会话内编译失败的工具名（不带 hash）：避免每次 probe 都重跑 swiftc */
const failedTools = new Set<string>();
/** 编译互斥：同一工具并发 ensure 只编译一次 */
const inflight = new Map<string, Promise<string | null>>();

export function defaultSwiftCacheRoot(): string {
  return join(homedir(), ".zen", "cache");
}

/**
 * 确保 Swift 工具可用，返回二进制绝对路径；不可用（非 macOS / swiftc 缺失 /
 * 编译失败）返回 null。产物与源码都落在 cacheRoot 下的 bin/ 与 src/。
 */
export function ensureSwiftTool(name: string, source: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return Promise.resolve(null);
  }
  const cacheRoot = defaultSwiftCacheRoot();
  const { bin, src } = swiftToolPaths(cacheRoot, name, source);
  const existing = inflight.get(bin) ?? compile(name, source, bin, src);
  inflight.set(bin, existing);
  existing.finally(() => inflight.delete(bin)).catch(() => undefined);
  return existing;
}

async function compile(name: string, source: string, bin: string, src: string): Promise<string | null> {
  if (failedTools.has(name)) {
    return null;
  }
  try {
    if (await fileExists(bin)) {
      return bin;
    }
    const binDir = join(bin, "..");
    const srcDir = join(src, "..");
    await mkdir(binDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await writeFile(src, source, "utf8");
    await execFileAsync("swiftc", ["-o", bin, src], { timeout: 120_000 });
    return bin;
  } catch {
    // swiftc 不存在 / 编译失败：本会话记住失败，不再反复重试
    failedTools.add(name);
    return null;
  }
}

/** 测试用：清空失败缓存与 in-flight 记录 */
export function resetSwiftToolStateForTest(): void {
  failedTools.clear();
  inflight.clear();
}
