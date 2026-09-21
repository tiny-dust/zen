import { uuidLike } from "./agent-parts";

import type { ReferenceItem } from "@zen/shared";

/** DuckDuckGo HTML 搜索（无需 API Key），解析结果链接与标题 */
export async function runWebSearch(query: string): Promise<ReferenceItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`websearch HTTP ${response.status}`);
  }
  const html = await response.text();
  const results: ReferenceItem[] = [];
  const seen = new Set<string>();
  // DDG html 结果块：class="result__a" 的 <a href="...">title</a>
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) && results.length < 8) {
    let href = match[1] ?? "";
    const rawTitle = (match[2] ?? "").replace(/<[^>]+>/g, "").trim();
    if (!href || !rawTitle) {
      continue;
    }
    // DDG 会包一层 //duckduckgo.com/l/?uddg=
    if (href.startsWith("//")) {
      href = `https:${href}`;
    }
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        href = uddg;
      }
      if (!/^https?:\/\//i.test(href)) {
        continue;
      }
    } catch {
      continue;
    }
    if (seen.has(href)) {
      continue;
    }
    seen.add(href);
    results.push({ id: uuidLike(), title: rawTitle, url: href });
  }
  return results;
}
