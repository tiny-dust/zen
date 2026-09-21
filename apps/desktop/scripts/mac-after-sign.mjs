import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * electron-builder afterSign：macOS 无 Developer ID 时做完整 ad-hoc 重签。
 *
 * 两段式签名（缺一不可）：
 * 1. --deep ad-hoc 重签：linker-signed 包缺少 Contents/_CodeSignature/CodeResources，
 *    Squirrel.Mac 安装更新时报 "code has no resources but signature indicates they must be present"。
 * 2. 仅对外层追加 identifier 型 designated requirement（DR）：
 *    ad-hoc 签名的默认 DR 是 `cdhash H"…"`（钉死本构建哈希），而 Squirrel.Mac 校验时
 *    要求「新包满足宿主的 DR」——cdhash 跨构建必然不同，更新必然报
 *    "code failed to satisfy specified code requirement(s)"。
 *    显式把 DR 固定为 `identifier "<appId>"` 后跨构建稳定，自动更新校验才能通过。
 *    若后续接入正式 Developer ID 证书签名，DR 会自动变为证书锚定，本脚本仍兼容。
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

  const appId = context.packager?.appInfo?.id ?? "com.zen.desktop";

  console.log(`[mac-after-sign] ad-hoc 重签: ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });

  // 第二段：仅重签外层（不带 --deep，嵌套已由上一步签好），显式设置 identifier 型 DR。
  // --deep 与 --requirements 同用时嵌套码会被改动导致 strict 校验失败，必须拆两步。
  const reqsDir = mkdtempSync(join(tmpdir(), "zen-sign-reqs-"));
  const reqsPath = join(reqsDir, "reqs.txt");
  writeFileSync(reqsPath, `designated => identifier "${appId}"\n`, "utf8");
  try {
    console.log(`[mac-after-sign] 设置跨构建 DR: identifier "${appId}"`);
    execFileSync("codesign", ["--force", "--sign", "-", "--requirements", reqsPath, appPath], {
      stdio: "inherit",
    });
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "inherit",
    });
  } finally {
    rmSync(reqsDir, { recursive: true, force: true });
  }
  console.log("[mac-after-sign] codesign verify 通过（DR 已固化为 identifier 型）");
}
