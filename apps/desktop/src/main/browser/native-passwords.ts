import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import Database from "better-sqlite3";

import type { BrowserImportSourceId } from "@zen/shared";

import { listChromiumProfiles, type ParsedPasswordRow } from "./import";

const execFileAsync = promisify(execFile);
const CSV_GUIDANCE = "此浏览器的密码无法直接解密。请在浏览器密码管理器中导出 CSV，再用 Zen 的「导入密码 CSV」导入。";

const MAC_KEYCHAIN_SERVICE: Record<"chrome" | "edge" | "brave", string> = {
  chrome: "Chrome Safe Storage",
  edge: "Microsoft Edge Safe Storage",
  brave: "Brave Safe Storage",
};

interface EncryptedLogin {
  origin_url: string;
  username_value: string;
  password_value: Buffer;
}

export interface NativePasswordReadResult {
  ok: boolean;
  rows: ParsedPasswordRow[];
  skipped: number;
  error?: string;
}

/** Chrome 的 v10/v11 (macOS/Linux) 使用 PBKDF2-SHA1 和 AES-128-CBC。 */
export function decryptCbcPassword(blob: Buffer, password: string, iterations: number): string {
  const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString("utf8");
}

/** Windows 的旧版 DPAPI 包装 AES key 对应 v10/v11 AES-256-GCM 记录。v20 为 app-bound，不尝试绕过。 */
export function decryptWindowsPassword(blob: Buffer, key: Buffer): string {
  if (key.length !== 32 || blob.length < 3 + 12 + 16) throw new Error("Invalid encrypted password");
  const nonce = blob.subarray(3, 15);
  const tag = blob.subarray(blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(15, -16)), decipher.final()]).toString("utf8");
}

/** macOS：让系统 Keychain 自行向当前登录用户请求访问权限，拒绝时安全失败。 */
async function macKeychainPassword(sourceId: "chrome" | "edge" | "brave"): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-w", "-s", MAC_KEYCHAIN_SERVICE[sourceId]],
      { timeout: 60_000, maxBuffer: 64 * 1024 },
    );
    return stdout.replace(/[\r\n]+$/, "") || null;
  } catch {
    return null;
  }
}

/** Windows：只使用当前用户 DPAPI；加密的 key 经 stdin 传入 PowerShell，不放进命令行。 */
async function windowsDpapiUnprotect(encrypted: Buffer): Promise<Buffer | null> {
  const script = [
    "$inputData = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Convert]::FromBase64String($inputData)",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($plain))",
  ].join("; ");
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<Buffer | null>((resolve) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      let output = "";
      let settled = false;
      const finish = (value: Buffer | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { if (output.length < 4096) output += chunk; });
      child.stdin.on("error", () => finish(null));
      child.on("error", () => finish(null));
      child.on("close", (code) => {
        if (code !== 0) return finish(null);
        try {
          const decoded = Buffer.from(output.trim(), "base64");
          finish(decoded.length === 32 ? decoded : null);
        } catch {
          finish(null);
        }
      });
      child.stdin.end(encrypted.toString("base64"));
      setTimeout(() => { if (!settled) child.kill(); }, 30_000).unref();
    });
  } catch {
    return null;
  }
}

async function windowsProfileKey(profileDir: string): Promise<Buffer | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dirname(profileDir), "Local State"), "utf8"));
    if (!parsed || typeof parsed !== "object" || !("os_crypt" in parsed)) return null;
    const crypt = parsed.os_crypt;
    if (!crypt || typeof crypt !== "object" || !("encrypted_key" in crypt)) return null;
    const encoded = crypt.encrypted_key;
    if (typeof encoded !== "string") return null;
    const blob = Buffer.from(encoded, "base64");
    if (blob.subarray(0, 5).toString("ascii") !== "DPAPI") return null;
    return windowsDpapiUnprotect(blob.subarray(5));
  } catch {
    return null;
  }
}

/** 复制主库及 WAL 后只读打开；不改动运行中的系统浏览器。 */
async function readProfileLogins(file: string): Promise<EncryptedLogin[]> {
  const source = file;
  const temp = await mkdtemp(join(tmpdir(), "zen-browser-passwords-"));
  try {
    const copy = join(temp, "Login Data");
    await copyFile(source, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${source}${suffix}`)) {
        await copyFile(`${source}${suffix}`, `${copy}${suffix}`);
      }
    }
    const db = new Database(copy, { readonly: true, fileMustExist: true });
    try {
      return db.prepare(`
        SELECT origin_url, username_value, password_value
        FROM logins
        WHERE password_value IS NOT NULL AND length(password_value) > 0
      `).all() as EncryptedLogin[];
    } finally {
      db.close();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function validLoginUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * 显式用户操作才读取密码；macOS 走 Keychain，Windows 走当前用户 DPAPI，
 * Linux 只识别 Chromium 无 Secret Service 时的 v10 本机格式；v11/keyring 不做猜测。
 * 不能解密的记录跳过，绝不把未知密文当明文存入 Zen。
 */
export async function importNativePasswords(
  sourceId: BrowserImportSourceId,
  platform: NodeJS.Platform = process.platform,
): Promise<NativePasswordReadResult> {
  if (sourceId !== "chrome" && sourceId !== "edge" && sourceId !== "brave") {
    return { ok: false, rows: [], skipped: 0, error: CSV_GUIDANCE };
  }
  const profiles = (await listChromiumProfiles()).filter((item) => item.id === sourceId && (
    existsSync(join(item.dir, "Login Data")) || existsSync(join(item.dir, "Login Data For Account"))
  ));
  if (!profiles.length) return { ok: false, rows: [], skipped: 0, error: "未找到此浏览器的本机密码库。" };

  const macPassword = platform === "darwin" ? await macKeychainPassword(sourceId) : null;
  if (platform === "darwin" && !macPassword) {
    return { ok: false, rows: [], skipped: 0, error: `未获准读取系统钥匙串。${CSV_GUIDANCE}` };
  }

  const rows: ParsedPasswordRow[] = [];
  let skipped = 0;
  let protectedRows = 0;
  let unreadableProfiles = 0;
  for (const profile of profiles) {
    const winKey = platform === "win32" ? await windowsProfileKey(profile.dir) : null;
    for (const fileName of ["Login Data", "Login Data For Account"]) {
      const file = join(profile.dir, fileName);
      if (!existsSync(file)) continue;
      let logins: EncryptedLogin[];
      try {
        logins = await readProfileLogins(file);
      } catch {
        unreadableProfiles += 1;
        continue;
      }
      for (const login of logins) {
        const url = typeof login.origin_url === "string" ? validLoginUrl(login.origin_url) : null;
        if (!url || !Buffer.isBuffer(login.password_value)) {
          skipped += 1;
          continue;
        }
        const prefix = login.password_value.subarray(0, 3).toString("ascii");
        if (prefix === "v20") {
          protectedRows += 1;
          skipped += 1;
          continue;
        }
        try {
          let password: string;
          if (platform === "darwin" && prefix === "v10" && macPassword) {
            password = decryptCbcPassword(login.password_value, macPassword, 1003);
          } else if (platform === "win32" && (prefix === "v10" || prefix === "v11") && winKey) {
            password = decryptWindowsPassword(login.password_value, winKey);
          } else if (platform === "linux" && prefix === "v10") {
            password = decryptCbcPassword(login.password_value, "peanuts", 1);
          } else {
            skipped += 1;
            continue;
          }
          if (!password) {
            skipped += 1;
            continue;
          }
          rows.push({
            name: new URL(url).hostname,
            url,
            username: typeof login.username_value === "string" ? login.username_value : "",
            password,
          });
        } catch {
          skipped += 1;
        }
      }
    }
    winKey?.fill(0);
  }
  if (!rows.length && (skipped || protectedRows || unreadableProfiles)) {
    const reason = protectedRows ? "此浏览器启用了应用绑定加密。" : "未能读取系统保护的密码库。";
    return { ok: false, rows: [], skipped, error: `${reason}${CSV_GUIDANCE}` };
  }
  return { ok: true, rows, skipped };
}
