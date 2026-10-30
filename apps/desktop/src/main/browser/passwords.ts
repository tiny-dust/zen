import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { decryptSecret, encryptSecret } from "../secret";
import { zenRoot } from "../zen-dir";

import type { StoredPasswordEntry } from "@zen/shared";

import type { ParsedPasswordRow } from "./import";

/**
 * 内置浏览器的密码库（~/.zen/browser-passwords.json）。
 *
 * 来自用户手动导入的浏览器 CSV（Chrome/Edge 导出格式）。密码一律用 aes:v1 加密存盘，
 * 明文只在「复制密码」时按条解密返回，列表接口不带明文；文件权限 0600。
 */

interface StoredRow {
  id: string;
  /** 站点 origin（协议 + 主机 + 端口），用于按站点归组 */
  origin: string;
  /** 显示名：导入时 CSV 的 name，缺省取主机名 */
  title: string;
  username: string;
  /** aes:v1 密文 */
  passwordEnc: string;
  createdAt: number;
}

interface StoreFile {
  version: 1;
  entries: StoredRow[];
}

function storePath(): string {
  return join(zenRoot(), "browser-passwords.json");
}

function readStore(): StoreFile {
  const file = storePath();
  if (!existsSync(file)) {
    return { version: 1, entries: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoreFile>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? (parsed.entries as StoredRow[]) : [],
    };
  } catch {
    // 文件损坏按空库处理，不阻断导入
    return { version: 1, entries: [] };
  }
}

function writeStore(data: StoreFile): void {
  const file = storePath();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(temp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows 无 POSIX 权限位，忽略
  }
}

/** 站点 origin：解析失败（非 http(s) 等）返回空串，导入时跳过 */
export function originFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function toEntry(row: StoredRow): StoredPasswordEntry {
  return {
    id: row.id,
    origin: row.origin,
    title: row.title,
    username: row.username,
    createdAt: row.createdAt,
  };
}

/** 列表（不含明文密码），最新导入在前 */
export function listStoredPasswords(): StoredPasswordEntry[] {
  return readStore().entries.map(toEntry).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 批量写入导入结果：同 origin + username 视为同一条（覆盖密码），其余新增。
 * 返回导入条数与被跳过的条数（URL 无法解析或字段缺失）。
 */
export async function upsertPasswords(
  rows: ParsedPasswordRow[],
): Promise<{ imported: number; skipped: number }> {
  const store = readStore();
  const index = new Map(store.entries.map((entry) => [`${entry.origin}|${entry.username}`, entry]));
  let imported = 0;
  let skipped = 0;
  const createdAt = Date.now();
  for (const row of rows) {
    const origin = originFromUrl(row.url);
    if (!origin || (!row.username && !row.password)) {
      skipped += 1;
      continue;
    }
    const passwordEnc = await encryptSecret(row.password);
    const key = `${origin}|${row.username}`;
    const existing = index.get(key);
    if (existing) {
      existing.passwordEnc = passwordEnc;
      existing.title = row.name || existing.title;
      imported += 1;
      continue;
    }
    const entry: StoredRow = {
      id: randomUUID(),
      origin,
      title: row.name || origin.replace(/^https?:\/\//, ""),
      username: row.username,
      passwordEnc,
      createdAt,
    };
    store.entries.push(entry);
    index.set(key, entry);
    imported += 1;
  }
  if (imported) {
    writeStore(store);
  }
  return { imported, skipped };
}

/** 取单条明文密码（复制按钮触发）；id 不存在或解密失败返回 null */
export async function revealPassword(id: string): Promise<string | null> {
  const row = readStore().entries.find((entry) => entry.id === id);
  if (!row) {
    return null;
  }
  try {
    return await decryptSecret(row.passwordEnc);
  } catch {
    return null;
  }
}

/** 删除单条 */
export function removePassword(id: string): boolean {
  const store = readStore();
  const next = store.entries.filter((entry) => entry.id !== id);
  if (next.length === store.entries.length) {
    return false;
  }
  writeStore({ version: 1, entries: next });
  return true;
}

/** 清空密码库 */
export function clearPasswords(): void {
  writeStore({ version: 1, entries: [] });
}
