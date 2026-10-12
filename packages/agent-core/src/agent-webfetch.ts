import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

/**
 * 轻量页面阅读（逆向自 DimAgent WebFetch：startIndex 分页 + reader 兜底）：
 * - fetch + @mozilla/readability 抽正文，turndown 转 markdown；
 * - 长页按字符分页返回（默认 1 万字符），截断时给 nextStartIndex 续读指针；
 * - 直抓失败回落 r.jina.ai reader；再失败才抛错。
 */

const DEFAULT_MAX_CHARS = 10_000;
const MAX_HTML_CHARS = 2_000_000;
const FETCH_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface WebFetchOptions {
  /** 续读偏移（字符）：上一次结果的 nextStartIndex */
  startIndex?: number;
  /** 本次最多返回的字符数（默认 10000，上限 50000） */
  maxChars?: number;
}

export interface WebFetchResult {
  url: string;
  title: string;
  /** 正文 markdown（从 startIndex 起的切片） */
  content: string;
  startIndex: number;
  /** 还有剩余内容时的续读偏移；已到结尾为 null */
  nextStartIndex: number | null;
  totalChars: number;
}

function assertHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`无效 URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`仅支持 http(s) URL，收到 ${parsed.protocol}`);
  }
  return parsed;
}

function responseType(contentType: string): "html" | "text" | "binary" {
  const mime = contentType.split(";")[0]?.trim() ?? "";
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return "html";
  }
  if (mime.startsWith("text/") || mime === "application/json") {
    return "text";
  }
  return "binary";
}

async function fetchText(url: string): Promise<{ text: string; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_HTML_CHARS) {
    throw new Error(`页面超过 2MB（content-length ${declared}），建议用 browserOpen 打开`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  return { text: raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw, contentType };
}

/** Readability 抽正文 → turndown 转 markdown；抽不到正文时退化为去脚本后的纯文本 */
function extractHtml(html: string, url: string): { title: string; markdown: string } {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const title = document.title.trim();
  const article = new Readability(document).parse();
  if (article?.content) {
    const markdown = turndown.turndown(article.content).trim();
    if (markdown) {
      return { title: (article.title || title).trim(), markdown };
    }
  }
  // 非文章型页面（导航/列表/文档壳）：去掉脚本样式后直接取文本
  for (const node of document.querySelectorAll("script, style, noscript")) {
    node.remove();
  }
  const text = (document.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    throw new Error("页面无可抽取正文");
  }
  return { title, markdown: text };
}

/** r.jina.ai reader 兜底：返回 "Title: …\n\nURL Source: …\n\nMarkdown Content:\n<正文>" */
async function fetchViaReader(url: string): Promise<{ title: string; markdown: string }> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`reader HTTP ${response.status}`);
  }
  const body = (await response.text()).trim();
  if (!body) {
    throw new Error("reader 返回空内容");
  }
  const title = /^Title:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  const content = /^Markdown Content:\s*$/m.exec(body)
    ? body.slice(body.indexOf("\n", body.indexOf("Markdown Content:")) + 1).trim()
    : body;
  return { title, markdown: content };
}

/**
 * 抓取页面并返回正文 markdown 分页切片。
 * 主链路失败（网络/反爬/解析）自动尝试 r.jina.ai reader，两路都失败才抛错。
 */
export async function runWebFetch(url: string, options?: WebFetchOptions): Promise<WebFetchResult> {
  const target = assertHttpUrl(url);
  const startIndex = Math.max(options?.startIndex ?? 0, 0);
  const maxChars = Math.min(Math.max(options?.maxChars ?? DEFAULT_MAX_CHARS, 500), 50_000);

  let title = "";
  let markdown = "";
  const errors: string[] = [];
  try {
    const { text, contentType } = await fetchText(target.href);
    const kind = responseType(contentType);
    if (kind === "binary") {
      throw new Error(`不支持的内容类型（${contentType.split(";")[0] || "unknown"}），建议用 browserOpen 打开`);
    }
    if (kind === "html") {
      const extracted = extractHtml(text, target.href);
      title = extracted.title;
      markdown = extracted.markdown;
    } else {
      title = "";
      markdown = text;
    }
  } catch (error) {
    errors.push(`直抓失败: ${error instanceof Error ? error.message : String(error)}`);
    try {
      const extracted = await fetchViaReader(target.href);
      title = extracted.title;
      markdown = extracted.markdown;
    } catch (readerError) {
      errors.push(`reader 兜底失败: ${readerError instanceof Error ? readerError.message : String(readerError)}`);
      throw new Error(`webfetch ${target.href}（${errors.join("；")}）`);
    }
  }

  const totalChars = markdown.length;
  const end = Math.min(startIndex + maxChars, totalChars);
  return {
    url: target.href,
    title,
    content: markdown.slice(startIndex, end),
    startIndex,
    nextStartIndex: end < totalChars ? end : null,
    totalChars,
  };
}
