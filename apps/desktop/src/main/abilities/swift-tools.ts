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

/** Swift 工具二进制名：`<name>-<sourceHash8>`，源码/plist 变化即换名重编，不会用到旧产物 */
export function swiftBinaryName(name: string, source: string, plist?: string): string {
  return `${name}-${createHash("sha1").update(source).update("\0").update(plist ?? "").digest("hex").slice(0, 8)}`;
}

export function swiftToolPaths(
  cacheRoot: string,
  name: string,
  source: string,
  plist?: string,
): {
  bin: string;
  src: string;
  plist: string | null;
  bundle: string | null;
} {
  const binDir = join(cacheRoot, "bin");
  const srcDir = join(cacheRoot, "src");
  const base = swiftBinaryName(name, source, plist);
  // 带 plist 的工具产出 .app bundle：macOS TCC 只认 bundle 的 Info.plist，
  // CLI 裸二进制（含 Mach-O 内嵌 plist 段）访问麦克风/语音识别会被直接 SIGABRT
  const bundle = plist ? join(binDir, `${base}.app`) : null;
  return {
    bin: bundle ? join(bundle, "Contents", "MacOS", name) : join(binDir, base),
    src: join(srcDir, `${base}.swift`),
    plist: plist ? join(bundle!, "Contents", "Info.plist") : null,
    bundle,
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
 * plist：可选的 Info.plist 内容——嵌入二进制 __TEXT,__info_plist 段，
 * 访问麦克风/语音识别等 TCC 管控资源时缺 usage description 会被系统直接 SIGABRT。
 */
export function ensureSwiftTool(name: string, source: string, plist?: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return Promise.resolve(null);
  }
  const cacheRoot = defaultSwiftCacheRoot();
  const { bin, src, plist: plistPath, bundle } = swiftToolPaths(cacheRoot, name, source, plist);
  const existing = inflight.get(bin) ?? compile(name, source, bin, src, plist ?? null, plistPath, bundle);
  inflight.set(bin, existing);
  existing.finally(() => inflight.delete(bin)).catch(() => undefined);
  return existing;
}

async function compile(
  name: string,
  source: string,
  bin: string,
  src: string,
  plist: string | null,
  plistPath: string | null,
  bundle: string | null,
): Promise<string | null> {
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
    if (plist && plistPath && bundle) {
      // bundle 模式：Info.plist 落 Contents/、可执行落 Contents/MacOS/，ad-hoc 签名
      await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
      await writeFile(plistPath, plist, "utf8");
      await execFileAsync("swiftc", ["-o", bin, src], { timeout: 120_000 });
      await execFileAsync("codesign", ["--force", "--sign", "-", bundle], { timeout: 30_000 });
      return bin;
    }
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
