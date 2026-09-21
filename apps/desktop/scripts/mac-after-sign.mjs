import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * electron-builder afterSign：macOS 无 Developer ID 时做完整 ad-hoc 重签。
 * 默认 linker-signed 包缺少 Contents/_CodeSignature/CodeResources，
 * Squirrel.Mac 安装更新时会报 "code has no resources but signature indicates they must be present"。
 */
export default async function macAfterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const appOutDir = context.appOutDir;
  const candidates = [
    context.packager?.appInfo?.productFilename,
    "Zen",
    "zen",
  ].filter(Boolean);

  let appPath = null;
  for (const name of candidates) {
    const p = join(appOutDir, `${name}.app`);
    if (existsSync(p)) {
      appPath = p;
      break;
    }
  }
  if (!appPath) {
    console.warn("[mac-after-sign] 未找到 .app，跳过 ad-hoc 重签:", appOutDir);
    return;
  }

  console.log(`[mac-after-sign] ad-hoc 重签: ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  console.log("[mac-after-sign] codesign verify 通过");
}
