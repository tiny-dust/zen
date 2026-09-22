import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { safeStorage } from "electron";

import { zenRoot } from "./zen-dir";

/**
 * 凭据加密方案（aes:v1）：AES-256-GCM + ~/.zen/db/.secret-key 本地密钥文件。
 *
 * 为什么不用 safeStorage 做主方案：macOS 上 ad-hoc 签名的构建每次更新都换
 * 签名身份，系统钥匙串拒绝新版本解密旧密文（「密钥信息解密失败」「反复掉登录」）。
 * 密钥文件随用户域目录跨版本稳定，更新后仍可解密。
 *
 * 兼容读取：无前缀的旧密文按 safeStorage / plain: 降级解密；
 * 解密成功后由 migrateSecretBlob 就地升级为 aes:v1。
 */
const AES_PREFIX = "aes:v1:";

function keyFilePath(): string {
  return join(zenRoot(), "db", ".secret-key");
}

function loadOrCreateKey(): Buffer {
  const file = keyFilePath();
  if (existsSync(file)) {
    const buf = readFileSync(file);
    if (buf.length === 32) {
      return buf;
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows 无 POSIX 权限位，忽略
  }
  return key;
}

export function isModernSecret(encoded: string): boolean {
  return encoded.startsWith(AES_PREFIX);
}

export async function encryptSecret(plain: string): Promise<string> {
  const key = loadOrCreateKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${AES_PREFIX}${Buffer.concat([iv, tag, body]).toString("base64")}`;
}

function decryptAes(encoded: string): string {
  const raw = Buffer.from(encoded.slice(AES_PREFIX.length), "base64");
  const key = loadOrCreateKey();
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** 旧版 safeStorage / plain: 密文的解密路径（仅迁移期使用） */
async function decryptLegacy(encoded: string): Promise<string> {
  const raw = Buffer.from(encoded, "base64");
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const { result } = await safeStorage.decryptStringAsync(raw);
      return result;
    } catch {
      // 系统钥匙串解密失败（重装/换机/密钥变更）：不要把密文当 utf8 读，
      // 否则会得到 U+FFFD，再进 HTTP header 就会 ByteString 崩溃。
      const text = raw.toString("utf8");
      if (text.startsWith("plain:")) {
        return text.slice("plain:".length);
      }
      throw new Error("本地密钥无法解密已保存的凭据，请重新登录或重新填写");
    }
  }
  const text = raw.toString("utf8");
  return text.startsWith("plain:") ? text.slice("plain:".length) : text;
}

export async function decryptSecret(encoded: string): Promise<string> {
  if (isModernSecret(encoded)) {
    return decryptAes(encoded);
  }
  return decryptLegacy(encoded);
}

/**
 * 旧密文就地升级为 aes:v1；已是新格式或解密失败返回 null（不改动）。
 * 启动时调用一次，保证下一次更新后凭据仍可读。
 */
export async function migrateSecretBlob(encoded: string): Promise<string | null> {
  if (!encoded || isModernSecret(encoded)) {
    return null;
  }
  try {
    const plain = await decryptLegacy(encoded);
    return await encryptSecret(plain);
  } catch {
    return null;
  }
}

export function maskSecret(plain: string): string {
  if (!plain) {
    return "";
  }
  if (plain.length <= 8) {
    return "••••••";
  }
  return `${plain.slice(0, 3)}••••${plain.slice(-4)}`;
}

/** HTTP header 值必须是 ByteString；出现非 Latin-1 / 替换符时 fetch 会直接 TypeError */
export function isByteSafeHeader(value: string): boolean {
  if (!value) {
    return false;
  }
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd || code < 1 || code > 255) {
      return false;
    }
  }
  return !/[\r\n\0]/.test(value);
}
