import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import Database from "better-sqlite3";

import type {
  BrowserImportSource,
  BrowserImportSourceId,
  BrowserHistoryItem,
  ImportedBookmark,
} from "@zen/shared";

/**
 * 从系统浏览器导入书签 / 历史记录（只读本地数据文件，不改动原文件）。
 *
 * 各浏览器的数据形态：
 * - Chromium 系（Chrome / Edge / Brave）：`User Data/<Profile>/Bookmarks`（JSON）与
 *   `History`（SQLite，last_visit_time 为 1601 纪元微秒）；
 * - Firefox：`Profiles/<xxx>/places.sqlite`（moz_bookmarks / moz_places）；
 * - Safari：`~/Library/Safari/Bookmarks.plist`（二进制 plist，走 plutil 转 JSON）
 *   与 `History.db`（history_items / history_visits，visit_time 为 2001 纪元秒）。
 *
 * 浏览器运行时 SQLite 文件被独占锁住，一律先复制到临时目录再读。
 */

const execFileAsync = promisify(execFile);

/** Chromium 时间戳（1601-01-01 起的微秒）→ 毫秒时间戳 */
const CHROMIUM_EPOCH_OFFSET_MS = 11644473600000;
/** Safari/Core Data 时间戳（2001-01-01 起的秒）→ 毫秒时间戳 */
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

const HISTORY_LIMIT = 500;

export interface ChromiumProfile {
  id: BrowserImportSourceId;
  name: string;
  /** Profile 目录（含 Bookmarks / History / Login Data） */
  dir: string;
}

const CHROMIUM_BRANDS: Array<{
  id: BrowserImportSourceId;
  name: string;
  /** macOS 相对 home；Windows 相对 LOCALAPPDATA；Linux 相对 XDG_CONFIG_HOME。 */
  roots: { darwin: string; win32: string; linux: string };
}> = [
  {
    id: "chrome",
    name: "Google Chrome",
    roots: {
      darwin: "Library/Application Support/Google/Chrome",
      win32: "Google/Chrome/User Data",
      linux: "google-chrome",
    },
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    roots: {
      darwin: "Library/Application Support/Microsoft Edge",
      win32: "Microsoft/Edge/User Data",
      linux: "microsoft-edge",
    },
  },
  {
    id: "brave",
    name: "Brave",
    roots: {
      darwin: "Library/Application Support/BraveSoftware/Brave-Browser",
      win32: "BraveSoftware/Brave-Browser/User Data",
      linux: "BraveSoftware/Brave-Browser",
    },
  },
];

function homePath(rel: string): string {
  return join(homedir(), rel);
}

function chromiumRoot(brand: (typeof CHROMIUM_BRANDS)[number]): string | null {
  // 各平台的用户配置目录可被重定向；环境变量缺失时回退到系统默认位置。
  switch (process.platform) {
    case "darwin": return homePath(brand.roots.darwin);
    case "win32": return join(process.env.LOCALAPPDATA || homePath("AppData/Local"), brand.roots.win32);
    case "linux": return join(process.env.XDG_CONFIG_HOME || homePath(".config"), brand.roots.linux);
    default: return null;
  }
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

/** 枚举本机存在的 Chromium Profile（Default / Profile N，含可导入数据文件才算） */
export async function listChromiumProfiles(): Promise<ChromiumProfile[]> {
  const out: ChromiumProfile[] = [];
  for (const brand of CHROMIUM_BRANDS) {
    const root = chromiumRoot(brand);
    if (!root || !existsSync(root)) continue;
    for (const dir of await listDirs(root)) {
      const hasBookmarks = existsSync(join(dir, "Bookmarks"));
      const hasHistory = existsSync(join(dir, "History"));
      const hasPasswords = existsSync(join(dir, "Login Data")) || existsSync(join(dir, "Login Data For Account"));
      if (hasBookmarks || hasHistory || hasPasswords) {
        out.push({ id: brand.id, name: brand.name, dir });
      }
    }
  }
  return out;
}

/** Firefox 配置文件目录（profiles.ini 里 default 标记无法简单解析时，按目录遍历兜底） */
async function listFirefoxProfiles(): Promise<string[]> {
  let candidates: string[];
  // Firefox 使用 Roaming AppData，而 Chromium 使用 Local AppData。
  switch (process.platform) {
    case "darwin":
      candidates = [homePath("Library/Application Support/Firefox/Profiles")];
      break;
    case "win32":
      candidates = [join(process.env.APPDATA || homePath("AppData/Roaming"), "Mozilla/Firefox/Profiles")];
      break;
    case "linux":
      candidates = [
        homePath(".mozilla/firefox"),
        join(process.env.XDG_CONFIG_HOME || homePath(".config"), "mozilla/firefox"),
      ];
      break;
    default:
      candidates = [];
  }
  const out: string[] = [];
  for (const base of candidates) {
    for (const dir of await listDirs(base)) {
      if (existsSync(join(dir, "places.sqlite"))) {
        out.push(dir);
      }
    }
    // 兼容用户把候选根目录指向 Firefox 配置根而非 Profiles 的情况。
    for (const dir of await listDirs(join(base, "Profiles"))) {
      if (existsSync(join(dir, "places.sqlite"))) {
        out.push(dir);
      }
    }
  }
  return out;
}

/** 本机可导入的数据源清单：只有真实存在数据文件的浏览器才列出来 */
export async function listImportSources(): Promise<BrowserImportSource[]> {
  const sources: BrowserImportSource[] = [];
  const chromium = await listChromiumProfiles();
  for (const brand of CHROMIUM_BRANDS) {
    const profiles = chromium.filter((profile) => profile.id === brand.id);
    if (!profiles.length) {
      continue;
    }
    sources.push({
      id: brand.id,
      name: brand.name,
      bookmarks: profiles.some((profile) => existsSync(join(profile.dir, "Bookmarks"))),
      history: profiles.some((profile) => existsSync(join(profile.dir, "History"))),
      passwords: profiles.some((profile) =>
        existsSync(join(profile.dir, "Login Data")) || existsSync(join(profile.dir, "Login Data For Account")),
      ),
    });
  }
  const firefox = await listFirefoxProfiles();
  if (firefox.length) {
    sources.push({ id: "firefox", name: "Firefox", bookmarks: true, history: true });
  }
  const safariBookmarks = homePath("Library/Safari/Bookmarks.plist");
  const safariHistory = homePath("Library/Safari/History.db");
  if (process.platform === "darwin" && (existsSync(safariBookmarks) || existsSync(safariHistory))) {
    sources.push({
      id: "safari",
      name: "Safari",
      bookmarks: existsSync(safariBookmarks),
      history: existsSync(safariHistory),
    });
  }
  return sources;
}

interface ChromiumBookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromiumBookmarkNode[];
}

/** Chromium Bookmarks JSON：递归收集 type=url 的叶子节点 */
function collectChromiumBookmarks(nodes: ChromiumBookmarkNode[] | undefined, out: ImportedBookmark[]): void {
  for (const node of nodes ?? []) {
    if (node.type === "url" && typeof node.url === "string" && node.url.trim()) {
      out.push({ title: (node.name ?? "").trim() || node.url, url: node.url });
    }
    if (node.children?.length) {
      collectChromiumBookmarks(node.children, out);
    }
  }
}

async function readChromiumBookmarks(profiles: ChromiumProfile[]): Promise<ImportedBookmark[]> {
  const out: ImportedBookmark[] = [];
  for (const profile of profiles) {
    const file = join(profile.dir, "Bookmarks");
    if (!existsSync(file)) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { roots?: Record<string, ChromiumBookmarkNode> };
      for (const rootNode of Object.values(parsed.roots ?? {})) {
        collectChromiumBookmarks(rootNode?.children, out);
      }
    } catch {
      // 单个 Profile 解析失败不影响其它 Profile
    }
  }
  return out;
}

/** Safari 二进制 plist → JSON（plutil 是 macOS 自带，不引入额外依赖） */
async function readSafariBookmarks(): Promise<ImportedBookmark[]> {
  const file = homePath("Library/Safari/Bookmarks.plist");
  if (!existsSync(file)) {
    return [];
  }
  const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", file], {
    maxBuffer: 64 * 1024 * 1024,
  });
  interface SafariNode {
    WebBookmarkType?: string;
    URLString?: string;
    URIDictionary?: { title?: string };
    Children?: SafariNode[];
  }
  const out: ImportedBookmark[] = [];
  const walk = (nodes: SafariNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.WebBookmarkType === "WebBookmarkTypeLeaf" && node.URLString) {
        out.push({
          title: node.URIDictionary?.title?.trim() || node.URLString,
          url: node.URLString,
        });
      }
      if (node.Children?.length) {
        walk(node.Children);
      }
    }
  };
  walk((JSON.parse(stdout) as SafariNode).Children);
  return out;
}

/** 把 SQLite 文件复制到临时目录再打开：浏览器运行时会对原文件加锁 */
async function withTempCopy<T>(file: string, read: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zen-import-"));
  try {
    const copy = join(dir, "data.sqlite");
    await copyFile(file, copy);
    return await read(copy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readFirefoxBookmarks(): Promise<ImportedBookmark[]> {
  const out: ImportedBookmark[] = [];
  for (const profile of await listFirefoxProfiles()) {
    const file = join(profile, "places.sqlite");
    try {
      const rows = await withTempCopy(file, async (copy) => {
        const db = new Database(copy, { readonly: true });
        try {
          return db
            .prepare(
              `SELECT b.title AS title, p.url AS url
                 FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
                WHERE b.type = 1 AND p.url IS NOT NULL`,
            )
            .all() as Array<{ title: string | null; url: string }>;
        } finally {
          db.close();
        }
      });
      for (const row of rows) {
        out.push({ title: (row.title ?? "").trim() || row.url, url: row.url });
      }
    } catch {
      // 单个 Profile 读取失败继续下一个
    }
  }
  return out;
}

/** 导入指定浏览器的书签（同 URL 去重，保留先出现的标题） */
export async function importBookmarks(
  sourceId: BrowserImportSourceId,
): Promise<{ ok: boolean; bookmarks: ImportedBookmark[]; error?: string }> {
  try {
    let bookmarks: ImportedBookmark[] = [];
    if (sourceId === "chrome" || sourceId === "edge" || sourceId === "brave") {
      const profiles = (await listChromiumProfiles()).filter((profile) => profile.id === sourceId);
      bookmarks = await readChromiumBookmarks(profiles);
    } else if (sourceId === "safari") {
      bookmarks = await readSafariBookmarks();
    } else if (sourceId === "firefox") {
      bookmarks = await readFirefoxBookmarks();
    } else {
      return { ok: false, bookmarks: [], error: "不支持的浏览器" };
    }
    const seen = new Set<string>();
    const unique = bookmarks.filter((item) => {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    });
    return { ok: true, bookmarks: unique };
  } catch (error) {
    return {
      ok: false,
      bookmarks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface HistoryRow {
  url: string;
  title: string | null;
  visitedAt: number;
}

/** 导入指定浏览器最近的历史（时间倒序，最多 HISTORY_LIMIT 条，按 URL 去重） */
export async function importHistory(
  sourceId: BrowserImportSourceId,
): Promise<{ ok: boolean; entries: BrowserHistoryItem[]; error?: string }> {
  try {
    let rows: HistoryRow[] = [];
    if (sourceId === "chrome" || sourceId === "edge" || sourceId === "brave") {
      const profiles = (await listChromiumProfiles()).filter((profile) => profile.id === sourceId);
      for (const profile of profiles) {
        const file = join(profile.dir, "History");
        if (!existsSync(file)) {
          continue;
        }
        try {
          const part = await withTempCopy(file, async (copy) => {
            const db = new Database(copy, { readonly: true });
            try {
              return db
                .prepare(
                  `SELECT url, title, last_visit_time AS visited
                     FROM urls
                    WHERE last_visit_time > 0
                    ORDER BY last_visit_time DESC
                    LIMIT ?`,
                )
                .all(HISTORY_LIMIT) as Array<{ url: string; title: string | null; visited: number }>;
            } finally {
              db.close();
            }
          });
          rows.push(
            ...part.map((row) => ({
              url: row.url,
              title: row.title,
              visitedAt: Math.round(row.visited / 1000) - CHROMIUM_EPOCH_OFFSET_MS,
            })),
          );
        } catch {
          // 单个 Profile 读取失败继续
        }
      }
    } else if (sourceId === "firefox") {
      for (const profile of await listFirefoxProfiles()) {
        try {
          const part = await withTempCopy(join(profile, "places.sqlite"), async (copy) => {
            const db = new Database(copy, { readonly: true });
            try {
              return db
                .prepare(
                  `SELECT url, title, last_visit_date AS visited
                     FROM moz_places
                    WHERE last_visit_date IS NOT NULL
                    ORDER BY last_visit_date DESC
                    LIMIT ?`,
                )
                .all(HISTORY_LIMIT) as Array<{ url: string; title: string | null; visited: number }>;
            } finally {
              db.close();
            }
          });
          rows.push(
            ...part.map((row) => ({ url: row.url, title: row.title, visitedAt: Math.round(row.visited / 1000) })),
          );
        } catch {
          // 单个 Profile 读取失败继续
        }
      }
    } else if (sourceId === "safari") {
      const file = homePath("Library/Safari/History.db");
      if (existsSync(file)) {
        rows = await withTempCopy(file, async (copy) => {
          const db = new Database(copy, { readonly: true });
          try {
            const part = db
              .prepare(
                `SELECT i.url AS url, v.title AS title, v.visit_time AS visited
                   FROM history_visits v JOIN history_items i ON i.id = v.history_item
                  ORDER BY v.visit_time DESC
                  LIMIT ?`,
              )
              .all(HISTORY_LIMIT) as Array<{ url: string; title: string | null; visited: number }>;
            return part.map((row) => ({
              url: row.url,
              title: row.title,
              visitedAt: APPLE_EPOCH_MS + row.visited * 1000,
            }));
          } finally {
            db.close();
          }
        });
      }
    } else {
      return { ok: false, entries: [], error: "不支持的浏览器" };
    }

    const seen = new Set<string>();
    const entries = rows
      .filter((row) => {
        if (!row.url || seen.has(row.url)) {
          return false;
        }
        seen.add(row.url);
        return true;
      })
      .slice(0, HISTORY_LIMIT)
      .map((row) => ({
        url: row.url,
        title: (row.title ?? "").trim() || row.url,
        visitedAt: row.visitedAt,
      }));
    return { ok: true, entries };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ParsedPasswordRow {
  name: string;
  url: string;
  username: string;
  password: string;
}

/** RFC4180 CSV：引号内的逗号、换行和双引号都属于字段内容。 */
function parseCsvRecords(text: string): string[][] | null {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  const finishRecord = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim())) records.push(cells);
    cells = [];
    cell = "";
    closedQuote = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n") return null;
    if (char === '"') {
      if (cell) return null;
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(cell);
      cell = "";
      closedQuote = false;
      continue;
    }
    if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    cell += char;
  }
  if (quoted) return null;
  finishRecord();
  return records;
}

function webUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * 按表头解析 Chrome/Edge/Safari（name/title,url,username,password）和
 * Firefox（url,username,password,...）导出；保留旧版无表头四列格式。
 * 未知表头直接拒绝，避免把列错位的值当作密码导入。
 */
export function parsePasswordCsv(text: string): {
  ok: boolean;
  rows: ParsedPasswordRow[];
  skipped: number;
  error?: string;
} {
  const records = parseCsvRecords(text);
  if (!records) {
    return { ok: false, rows: [], skipped: 0, error: "密码 CSV 引号格式不正确" };
  }
  if (!records.length) {
    return { ok: false, rows: [], skipped: 0, error: "CSV 文件为空" };
  }
  const rows: ParsedPasswordRow[] = [];
  let skipped = 0;
  const headers = (records[0] ?? []).map((cell) => cell.replace(/^\uFEFF/, "").trim().toLowerCase());
  const findHeader = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  let nameIndex = findHeader("name", "title");
  let urlIndex = findHeader("url", "website");
  let usernameIndex = findHeader("username", "user name");
  let passwordIndex = findHeader("password");
  let start = 1;
  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    // 兼容旧版无表头四列数据；先验证第二列确实是网页 URL。
    if ((records[0]?.length ?? 0) >= 4 && webUrl((records[0]?.[1] ?? "").trim())) {
      nameIndex = 0;
      urlIndex = 1;
      usernameIndex = 2;
      passwordIndex = 3;
      start = 0;
    } else {
      return { ok: false, rows: [], skipped: 0, error: "无法识别密码 CSV 表头" };
    }
  }
  for (let index = start; index < records.length; index += 1) {
    const cells = records[index] ?? [];
    const url = (cells[urlIndex] ?? "").trim();
    const username = (cells[usernameIndex] ?? "").trim();
    const password = cells[passwordIndex] ?? "";
    if (!webUrl(url) || (!username && !password)) {
      skipped += 1;
      continue;
    }
    rows.push({ name: nameIndex < 0 ? "" : (cells[nameIndex] ?? "").trim(), url, username, password });
  }
  if (!rows.length) {
    return { ok: false, rows: [], skipped, error: "CSV 中没有可导入的密码条目" };
  }
  return { ok: true, rows, skipped };
}
