import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ipcMain } from "electron";

import { zenCacheRoot } from "./zen-dir";

/**
 * 站点 favicon 拉取与缓存（浏览器历史 / 网络搜索来源的站点图标）。
 *
 * 渲染层 CSP 只允许 self/data 图片，所以不走 <img src="https://…">：由主进程抓取
 * 一次、转成 data URL 交给渲染层，渲染层只做展示与失败回退。
 * 缓存两级：进程内存 + ~/.zen/cache/favicons（按站点源哈希落盘），命中不重复请求。
 */

/** 成功结果缓存时长：站点图标基本不变，7 天足够 */
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 失败结果缓存时长：避免每次渲染都去戳一遍没有图标的站点 */
const FAIL_TTL_MS = 30 * 60 * 1000;
/** 单个图标允许的最大字节：超过就不是 favicon 了 */
const MAX_BYTES = 256 * 1024;
/** 抓取超时：图标是装饰，不能拖慢列表 */
const TIMEOUT_MS = 4000;

interface CacheEntry {
  dataUrl: string | null;
  at: number;
}

const memory = new Map<string, CacheEntry>();

export function clearFaviconMemory(): void {
  memory.clear();
}

/** favicon 落盘目录（用户域缓存，不进软件包） */
export function faviconCacheDir(): string {
  return join(zenCacheRoot(), "favicons");
}

/** 站点源（http(s)://host）；非 http(s) 返回空串 */
export function siteOriginOf(url: string): string {
  try {
    const parsed = new URL((url || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
  } catch {
    return "";
  }
}

function fresh(entry: CacheEntry | undefined, ttlOk: number, ttlFail: number): boolean {
  if (!entry) {
    return false;
  }
  return Date.now() - entry.at < (entry.dataUrl ? ttlOk : ttlFail);
}

function diskFile(origin: string, cacheDir: string): string {
  const hash = createHash("sha1").update(origin).digest("hex");
  return join(cacheDir, `${hash}.json`);
}

async function readDisk(origin: string, cacheDir: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(diskFile(origin, cacheDir), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.at !== "number") {
      return null;
    }
    if (parsed.dataUrl != null && typeof parsed.dataUrl !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeDisk(origin: string, entry: CacheEntry, cacheDir: string): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(diskFile(origin, cacheDir), JSON.stringify(entry), "utf8");
  } catch {
    // 缓存写失败不影响展示
  }
}

/** 单次带超时的请求：超时/网络错误一律返回 null，不影响列表 */
async function request(
  url: string,
  fetchImpl: typeof fetch,
  accept: string,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept },
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 下载一张图片并转 data URL：只接受 image/*，超出大小上限视为不是图标 */
async function fetchImage(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const response = await request(url, fetchImpl, "image/*");
  if (!response) {
    return null;
  }
  const mime = (response.headers.get("content-type") || "").split(";")[0]?.trim() || "";
  if (!mime.startsWith("image/")) {
    return null;
  }
  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) {
      return null;
    }
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/** 只读前 64KB 页面 HTML，找 <link rel="...icon..." href="...">（很多站点不提供 /favicon.ico） */
const PAGE_HEAD_BYTES = 64 * 1024;

async function declaredIconUrl(pageUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  const response = await request(pageUrl, fetchImpl, "text/html");
  if (!response) {
    return null;
  }
  let html = "";
  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    html = buffer.subarray(0, PAGE_HEAD_BYTES).toString("utf8");
  } catch {
    return null;
  }
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) {
      continue;
    }
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim();
    if (!href || href.startsWith("data:")) {
      continue;
    }
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        return resolved.toString();
      }
    } catch {
      // 非法 href：看下一个 link
    }
  }
  return null;
}

/** 取图标：站点根 /favicon.ico → 页面声明的 <link rel=icon>；http 站点再退回 https */
async function download(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const candidates = [origin];
  if (origin.startsWith("http://")) {
    candidates.push(`https://${origin.slice("http://".length)}`);
  }
  for (const base of candidates) {
    const direct = await fetchImage(`${base}/favicon.ico`, fetchImpl);
    if (direct) {
      return direct;
    }
    const declared = await declaredIconUrl(base, fetchImpl);
    if (declared) {
      const fromHtml = await fetchImage(declared, fetchImpl);
      if (fromHtml) {
        return fromHtml;
      }
    }
  }
  return null;
}

export async function fetchSiteFavicon(
  url: string,
  options: { cacheDir?: string; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const origin = siteOriginOf(url);
  if (!origin) {
    return null;
  }
  const cacheDir = options.cacheDir ?? faviconCacheDir();
  const cached = memory.get(origin);
  if (fresh(cached, OK_TTL_MS, FAIL_TTL_MS)) {
    return cached?.dataUrl ?? null;
  }
  const fromDisk = await readDisk(origin, cacheDir);
  if (fresh(fromDisk ?? undefined, OK_TTL_MS, FAIL_TTL_MS)) {
    memory.set(origin, fromDisk as CacheEntry);
    return fromDisk?.dataUrl ?? null;
  }
  const dataUrl = await download(origin, options.fetchImpl ?? fetch);
  const entry: CacheEntry = { dataUrl, at: Date.now() };
  memory.set(origin, entry);
  await writeDisk(origin, entry, cacheDir);
  return dataUrl;
}

export function registerFaviconIpc(): void {
  ipcMain.handle(
    "site:favicon",
    async (_event, url?: string): Promise<string | null> => {
      if (!url || typeof url !== "string") {
        return null;
      }
      return fetchSiteFavicon(url);
    },
  );
}
