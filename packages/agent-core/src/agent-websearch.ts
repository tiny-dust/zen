import { uuidLike } from "./agent-parts";

import type { ReferenceItem, WebSearchApiProviderId } from "@zen/shared";

/**
 * 多供应商网络搜索（逆向自 DimAgent provider 注册表 + MiMo 引擎 fallback 思路）：
 * - API 供应商（Tavily / 博查 / Serper）按配置顺序优先，免登录抓取（DuckDuckGo lite / Bing）兜底；
 * - 请求失败或结果为空自动落到下一家，全部失败才抛错；
 * - 各家结果统一归一化为 ReferenceItem（title / url / snippet）。
 *
 * DuckDuckGo HTML 端点（html.duckduckgo.com/html）已对 GET 返回 202 反爬挑战，
 * lite 端点（lite.duckduckgo.com/lite）仍返回纯 HTML 结果，故免登录首选 lite。
 */

export type WebSearchEngineId = WebSearchApiProviderId | "ddg" | "bing";

export interface WebSearchOptions {
  /** 已配置 Key 的 API 供应商（desktop 从密文读回注入；缺省只走免登录抓取） */
  apiKeys?: Partial<Record<WebSearchApiProviderId, string>>;
  /** 最多返回条数（默认 8） */
  maxResults?: number;
}

export interface WebSearchOutcome {
  /** 实际产出结果的引擎（fallback 链上第一个成功的） */
  provider: WebSearchEngineId;
  results: ReferenceItem[];
}

/** 免登录兜底引擎固定垫底；API 供应商配置了 Key 才进链 */
const ENGINE_CHAIN: WebSearchEngineId[] = ["tavily", "bocha", "serper", "ddg", "bing"];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SEARCH_TIMEOUT_MS = 10_000;
/** snippet 喂给模型的合理长度：超长截断，避免结果块挤占上下文 */
const SNIPPET_MAX_CHARS = 280;

type EngineFetcher = (
  query: string,
  maxResults: number,
  apiKey: string | undefined,
) => Promise<ReferenceItem[]>;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(text: string): string {
  return decodeEntities(stripTags(text));
}

function trimSnippet(text: string): string | undefined {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > SNIPPET_MAX_CHARS ? `${cleaned.slice(0, SNIPPET_MAX_CHARS)}…` : cleaned;
}

function normalizeResult(raw: {
  title?: string;
  url?: string;
  snippet?: string;
}): ReferenceItem | null {
  const title = cleanText(raw.title ?? "");
  const url = (raw.url ?? "").trim();
  if (!title || !/^https?:\/\//i.test(url)) {
    return null;
  }
  return { id: uuidLike(), title, url, snippet: trimSnippet(raw.snippet ?? "") };
}

function dedupe(results: Array<ReferenceItem | null>, maxResults: number): ReferenceItem[] {
  const seen = new Set<string>();
  const output: ReferenceItem[] = [];
  for (const item of results) {
    if (!item || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    output.push(item);
    if (output.length >= maxResults) {
      break;
    }
  }
  return output;
}

async function asJson(response: Response, engine: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${engine} HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${engine} 返回非 JSON 响应`);
  }
}

// ---------------------------------------------------------------------------
// Tavily：POST api.tavily.com/search，results[].content 即正文摘要
// ---------------------------------------------------------------------------

const searchTavily: EngineFetcher = async (query, maxResults, apiKey) => {
  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  const data = (await asJson(response, "tavily")) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return dedupe(
    (data.results ?? []).map((item) =>
      normalizeResult({ title: item.title, url: item.url, snippet: item.content }),
    ),
    maxResults,
  );
};

// ---------------------------------------------------------------------------
// 博查：POST api.bochaai.com/v1/web-search，summary 开启时给长摘要（比 snippet 更适合喂模型）
// ---------------------------------------------------------------------------

const searchBocha: EngineFetcher = async (query, maxResults, apiKey) => {
  const response = await fetchWithTimeout("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count: maxResults, summary: true }),
  });
  const data = (await asJson(response, "bocha")) as {
    code?: number;
    data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string }> } };
  };
  const pages = data.data?.webPages?.value ?? [];
  return dedupe(
    pages.map((item) =>
      normalizeResult({
        title: item.name,
        url: item.url,
        snippet: item.summary || item.snippet,
      }),
    ),
    maxResults,
  );
};

// ---------------------------------------------------------------------------
// Serper：POST google.serper.dev/search，取 organic 结果
// ---------------------------------------------------------------------------

const searchSerper: EngineFetcher = async (query, maxResults, apiKey) => {
  const response = await fetchWithTimeout("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey ?? "" },
    body: JSON.stringify({ q: query, num: maxResults }),
  });
  const data = (await asJson(response, "serper")) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return dedupe(
    (data.organic ?? []).map((item) =>
      normalizeResult({ title: item.title, url: item.link, snippet: item.snippet }),
    ),
    maxResults,
  );
};

// ---------------------------------------------------------------------------
// DuckDuckGo lite：纯 HTML 表格，链接与摘要按出现顺序成对
// ---------------------------------------------------------------------------

/** DDG 重定向链接（//duckduckgo.com/l/?uddg=<encoded>）还原真实目标 */
function decodeDdgRedirect(href: string): string {
  try {
    const parsed = new URL(href, "https://lite.duckduckgo.com");
    const encoded = parsed.searchParams.get("uddg");
    return encoded ? decodeURIComponent(encoded) : href;
  } catch {
    return href;
  }
}

const searchDuckDuckGo: EngineFetcher = async (query, maxResults) => {
  const response = await fetchWithTimeout(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`ddg HTTP ${response.status}`);
  }
  const html = await response.text();

  // lite 页面锚点形如 <a rel="nofollow" href="…" class='result-link'>（单引号、href 在前），属性顺序无关匹配
  const anchorRe = /<a\s[^>]*result-link[^>]*>([\s\S]*?)<\/a>/gi;
  const links: Array<{ href: string; title: string }> = [];
  for (const anchor of html.matchAll(anchorRe)) {
    const hrefMatch = (anchor[0] ?? "").match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) {
      continue;
    }
    const href = decodeEntities(hrefMatch[1] ?? "");
    links.push({
      href: href.includes("uddg=") ? decodeDdgRedirect(href) : href,
      title: cleanText(anchor[1] ?? ""),
    });
  }
  const snippetRe = /<td[^>]*result-snippet[^>]*>([\s\S]*?)<\/td>/gi;
  const snippets = [...html.matchAll(snippetRe)].map((match) => cleanText(match[1] ?? ""));

  return dedupe(
    links.map((link, index) => normalizeResult({ title: link.title, url: link.href, snippet: snippets[index] })),
    maxResults,
  );
};

// ---------------------------------------------------------------------------
// Bing：b_algo 结果块，标题在 h2 > a，摘要在其后的第一个 <p>
// ---------------------------------------------------------------------------

/** Bing 结果链接是 bing.com/ck/a?...&u=<base64url> 重定向；解出真实目标 URL */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeBingRedirect(href: string): string {
  try {
    const parsed = new URL(href, "https://www.bing.com/search");
    const encoded = parsed.searchParams.get("u");
    if (!encoded) {
      return "";
    }
    // 现版 Bing 的 u 值带 a1 前缀标记（u=a1<base64url>），直接解码是乱码；
    // 带/不带前缀各试一次，取解出合法 http(s) 的那个
    for (const candidate of [encoded, encoded.replace(/^a1/, "")]) {
      const decoded = decodeBase64Url(candidate);
      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }
    }
    return "";
  } catch {
    return "";
  }
}

function resolveBingHref(rawHref: string): string {
  const href = decodeEntities(rawHref);
  return href.includes("bing.com/ck/a") ? decodeBingRedirect(href) : href;
}

const searchBing: EngineFetcher = async (query, maxResults) => {
  const response = await fetchWithTimeout(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`bing HTTP ${response.status}`);
  }
  const html = await response.text();

  // 结果条目：<li class="b_algo"> … <h2><a href="...">title</a></h2> … <p>snippet</p> … </li>
  const blockRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi;
  const results: Array<ReferenceItem | null> = [];
  for (const block of html.matchAll(blockRe)) {
    const body = block[0] ?? "";
    const linkMatch = body.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }
    // 摘要在 h2 之后的第一个 <p>（b_caption 等），避免误吃标题本身的标记
    const afterTitle = body.slice((linkMatch.index ?? 0) + linkMatch[0].length);
    const snippetMatch = afterTitle.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push(
      normalizeResult({
        title: cleanText(linkMatch[2] ?? ""),
        url: resolveBingHref(linkMatch[1] ?? ""),
        snippet: snippetMatch?.[1],
      }),
    );
  }
  return dedupe(results, maxResults);
};

const ENGINES: Record<WebSearchEngineId, EngineFetcher> = {
  tavily: searchTavily,
  bocha: searchBocha,
  serper: searchSerper,
  ddg: searchDuckDuckGo,
  bing: searchBing,
};

function isApiEngine(engine: WebSearchEngineId): engine is WebSearchApiProviderId {
  return engine === "tavily" || engine === "bocha" || engine === "serper";
}

/**
 * 按 fallback 链搜索：配置了 Key 的 API 供应商在前（tavily → bocha → serper），
 * 免登录抓取垫底（ddg → bing）；失败或零结果自动换下一家。
 */
export async function searchWeb(query: string, options?: WebSearchOptions): Promise<WebSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("websearch 查询为空");
  }
  const maxResults = Math.min(Math.max(options?.maxResults ?? 8, 1), 20);
  const apiKeys = options?.apiKeys ?? {};

  const errors: string[] = [];
  let lastProvider: WebSearchEngineId | null = null;
  for (const engine of ENGINE_CHAIN) {
    if (isApiEngine(engine) && !apiKeys[engine]) {
      continue;
    }
    try {
      const results = await ENGINES[engine](trimmed, maxResults, apiKeys[engine as WebSearchApiProviderId]);
      // 引擎本身成功（哪怕 0 结果）就记为最后落点；空结果继续换下一家
      lastProvider = engine;
      if (results.length > 0) {
        return { provider: engine, results };
      }
    } catch (error) {
      errors.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // 至少一家成功但都零结果 → 返回空结果（模型可据此换 query），不算失败
  if (lastProvider) {
    return { provider: lastProvider, results: [] };
  }
  throw new Error(`websearch 全部来源失败（${errors.join("；")}）`);
}
