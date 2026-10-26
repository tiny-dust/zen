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

interface ChromiumProfile {
  id: BrowserImportSourceId;
  name: string;
  /** Profile 目录（含 Bookmarks / History） */
  dir: string;
}

const CHROMIUM_BRANDS: Array<{
  id: BrowserImportSourceId;
  name: string;
  /** 相对 home 的 User Data 目录候选（macOS / Linux / Windows 三平台） */
  roots: string[];
}> = [
  {
    id: "chrome",
    name: "Google Chrome",
    roots: [
      "Library/Application Support/Google/Chrome",
      ".config/google-chrome",
      "AppData/Local/Google/Chrome/User Data",
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    roots: [
      "Library/Application Support/Microsoft Edge",
      ".config/microsoft-edge",
      "AppData/Local/Microsoft/Edge/User Data",
    ],
  },
  {
    id: "brave",
    name: "Brave",
    roots: [
      "Library/Application Support/BraveSoftware/Brave-Browser",
      ".config/BraveSoftware/Brave-Browser",
      "AppData/Local/BraveSoftware/Brave-Browser/User Data",
    ],
  },
];

function homePath(rel: string): string {
  return join(homedir(), rel);
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

/** 枚举本机存在的 Chromium Profile（Default / Profile N，含 Bookmarks 或 History 才算） */
async function listChromiumProfiles(): Promise<ChromiumProfile[]> {
  const out: ChromiumProfile[] = [];
  for (const brand of CHROMIUM_BRANDS) {
    for (const rel of brand.roots) {
      const root = homePath(rel);
      if (!existsSync(root)) {
        continue;
      }
      for (const dir of await listDirs(root)) {
        const hasBookmarks = existsSync(join(dir, "Bookmarks"));
        const hasHistory = existsSync(join(dir, "History"));
        if (hasBookmarks || hasHistory) {
          out.push({ id: brand.id, name: brand.name, dir });
        }
      }
    }
  }
  return out;
}

/** Firefox 配置文件目录（profiles.ini 里 default 标记无法简单解析时，按目录遍历兜底） */
async function listFirefoxProfiles(): Promise<string[]> {
  const root = homePath("Library/Application Support/Firefox/Profiles");
  const linuxRoot = homePath(".config/mozilla/firefox");
  const candidates = [root, linuxRoot];
  const out: string[] = [];
  for (const base of candidates) {
    for (const dir of await listDirs(base)) {
      if (existsSync(join(dir, "places.sqlite"))) {
        out.push(dir);
      }
    }
    // Windows: %APPDATA%\Mozilla\Firefox\Profiles\<xxx><ProfileName>
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
    });
  }
  const firefox = await listFirefoxProfiles();
  if (firefox.length) {
    sources.push({ id: "firefox", name: "Firefox", bookmarks: true, history: true });
  }
  const safariBookmarks = homePath("Library/Safari/Bookmarks.plist");
  const safariHistory = homePath("Library/Safari/History.db");
  if (existsSync(safariBookmarks) || existsSync(safariHistory)) {
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

/** RFC4180 风格的 CSV 行拆分（支持引号包裹、引号内逗号与转义引号） */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

/**
 * 解析浏览器导出的密码 CSV（Chrome / Edge 导出格式：name,url,username,password,note）。
 * 缺列的行计入 skipped；表头行按首列名识别并跳过。
 */
export function parsePasswordCsv(text: string): {
  ok: boolean;
  rows: ParsedPasswordRow[];
  skipped: number;
  error?: string;
} {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { ok: false, rows: [], skipped: 0, error: "CSV 文件为空" };
  }
  const rows: ParsedPasswordRow[] = [];
  let skipped = 0;
  let start = 0;
  const firstCells = splitCsvLine(lines[0] ?? "").map((cell) => cell.trim().toLowerCase());
  if (firstCells[0] === "name" && firstCells[1] === "url") {
    start = 1;
  }
  for (let index = start; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index] ?? "");
    const url = (cells[1] ?? "").trim();
    const username = (cells[2] ?? "").trim();
    const password = cells[3] ?? "";
    if (!url || (!username && !password)) {
      skipped += 1;
      continue;
    }
    rows.push({ name: (cells[0] ?? "").trim(), url, username, password });
  }
  if (!rows.length) {
    return { ok: false, rows: [], skipped, error: "CSV 中没有可导入的密码条目" };
  }
  return { ok: true, rows, skipped };
}
