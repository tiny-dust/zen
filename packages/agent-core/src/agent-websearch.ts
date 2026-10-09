import { uuidLike } from "./agent-parts";

import type { ReferenceItem } from "@zen/shared";

/**
 * Bing HTML 搜索（无需 API Key）。
 * DuckDuckGo HTML 端点（html.duckduckgo.com/html）现已对 GET 返回 202 反爬挑战，
 * 无法再解析出结果，故改为 Bing 的普通搜索结果页。
 */

const BING_SEARCH_URL = "https://www.bing.com/search";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Bing 结果链接是 bing.com/ck/a?...&u=<base64url> 重定向；解出真实目标 URL */
function decodeBingRedirect(href: string): string {
  try {
    const parsed = new URL(href, BING_SEARCH_URL);
    const encoded = parsed.searchParams.get("u");
    if (!encoded) {
      return "";
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** 从链接 href 得到可直接访问的 URL：ck/a 重定向解码，否则原样返回 */
function resolveHref(rawHref: string): string {
  const href = rawHref.replace(/&amp;/g, "&");
  if (href.includes("bing.com/ck/a")) {
    return decodeBingRedirect(href);
  }
  return href;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

export async function runWebSearch(query: string): Promise<ReferenceItem[]> {
  const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`websearch HTTP ${response.status}`);
  }
  const html = await response.text();

  const results: ReferenceItem[] = [];
  const seen = new Set<string>();

  // 结果条目：<li class="b_algo"> … <h2><a href="...">title</a></h2> … </li>
  const blockRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi;
  const blocks = html.match(blockRe) ?? [];

  for (const block of blocks) {
    if (results.length >= 8) {
      break;
    }
    // 标题链接：<h2><a ... href="..." ...>title</a></h2>
    const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }
    const href = resolveHref(linkMatch[1] ?? "");
    const title = stripTags(linkMatch[2] ?? "");
    if (!href || !/^https?:\/\//i.test(href) || !title) {
      continue;
    }
    if (seen.has(href)) {
      continue;
    }
    seen.add(href);
    results.push({ id: uuidLike(), title, url: href });
  }

  return results;
}
