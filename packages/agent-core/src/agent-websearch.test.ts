import { afterEach, describe, expect, it, vi } from "vitest";

import { searchWeb } from "./agent-websearch";

/**
 * 多供应商搜索（fallback 链）：
 * - API 供应商按 tavily → bocha → serper（仅配置了 Key 的进链），免登录 ddg → bing 垫底
 * - 各家结果归一化为 {title,url,snippet}，去重、截断到 maxResults
 * - 失败或零结果自动换下一家；全部失败抛汇总错误
 */

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function htmlResponse(html: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => html,
  } as unknown as Response;
}

function bingRedirectHref(target: string): string {
  const encoded = Buffer.from(target, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  // 现版 Bing 的 u 值带 a1 前缀标记
  return `https://www.bing.com/ck/a?!&amp;p=x&amp;u=a1${encoded}&amp;ntb=1`;
}

function bingBlock(href: string, title: string, snippet: string): string {
  return `<li class="b_algo"><h2><a target="_blank" href="${href}">${title}</a></h2>` +
    `<div class="b_caption"><p>${snippet}</p></div></li>`;
}

function ddgLtiePage(items: Array<{ href: string; title: string; snippet: string }>): string {
  const links = items
    .map((item) => `<a rel="nofollow" class="result-link" href="${item.href}">${item.title}</a>`)
    .join("</td></tr><tr><td>");
  const snippets = items.map((item) => `<td class="result-snippet">${item.snippet}</td>`).join("</tr><tr>");
  return `<table><tr><td>${links}</td></tr><tr>${snippets}</tr></table>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchWeb 引擎解析", () => {
  it("Bing：解析 b_algo 标题/摘要并还原 ck/a 重定向", async () => {
    const html = [
      bingBlock(bingRedirectHref("https://example.com/page"), "Example <b>Page</b>", "A &amp; B 摘要"),
      bingBlock("https://direct.test/a", "Direct", ""),
    ].join("\n");
    const fetchMock = vi.fn(async () => htmlResponse(html));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("hello world");

    expect(outcome.provider).toBe("bing");
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]).toMatchObject({
      title: "Example Page",
      url: "https://example.com/page",
      snippet: "A & B 摘要",
    });
    expect(outcome.results[1]).toMatchObject({ title: "Direct", url: "https://direct.test/a" });
    expect(outcome.results[0]?.id).toBeTruthy();
  });

  it("DuckDuckGo lite：链接与摘要按出现顺序配对，uddg 重定向解码", async () => {
    const encoded = encodeURIComponent("https://example.com/ddg");
    const html = ddgLtiePage([
      { href: `//duckduckgo.com/l/?uddg=${encoded}&rut=abc`, title: "Ddg <em>Result</em>", snippet: "Ddg 摘要" },
      { href: "https://direct.test/b", title: "Direct B", snippet: "B 摘要" },
    ]);
    const fetchMock = vi.fn(async () => htmlResponse(html));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("hello");

    expect(outcome.provider).toBe("ddg");
    expect(outcome.results[0]).toMatchObject({
      title: "Ddg Result",
      url: "https://example.com/ddg",
      snippet: "Ddg 摘要",
    });
    expect(outcome.results[1]).toMatchObject({ title: "Direct B", snippet: "B 摘要" });
  });

  it("Tavily：归一化 content 为 snippet，超长截断", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.tavily.com/search");
      return jsonResponse({
        results: [
          { title: "Tavily Hit", url: "https://t.test/a", content: "c".repeat(400) },
          { title: "no-url", url: "not-a-url", content: "skip" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("q", { apiKeys: { tavily: "tvly-key" } });

    expect(outcome.provider).toBe("tavily");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.snippet).toMatch(/^c+…$/);
    expect(outcome.results[0]?.snippet?.length).toBeLessThanOrEqual(281);
  });

  it("博查：summary 优先于 snippet", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.bochaai.com/v1/web-search");
      const body = JSON.parse(String(init?.body));
      expect(body.summary).toBe(true);
      return jsonResponse({
        code: 200,
        data: {
          webPages: {
            value: [{ name: "Bocha Hit", url: "https://b.test/a", snippet: "短摘要", summary: "长摘要正文" }],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("q", { apiKeys: { bocha: "bocha-key" } });

    expect(outcome.provider).toBe("bocha");
    expect(outcome.results[0]).toMatchObject({ title: "Bocha Hit", snippet: "长摘要正文" });
  });

  it("Serper：取 organic 结果", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://google.serper.dev/search");
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("serper-key");
      return jsonResponse({ organic: [{ title: "Serper Hit", link: "https://s.test/a", snippet: "Serper 摘要" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("q", { apiKeys: { serper: "serper-key" } });

    expect(outcome.provider).toBe("serper");
    expect(outcome.results[0]).toMatchObject({ title: "Serper Hit", url: "https://s.test/a" });
  });
});

describe("searchWeb fallback 链", () => {
  it("配置了 Key 的 API 供应商失败后落到 ddg；ddg 空结果落到 bing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://api.tavily.com/search") {
        return jsonResponse({}, false, 401);
      }
      if (url.startsWith("https://lite.duckduckgo.com")) {
        return htmlResponse("<table></table>");
      }
      return htmlResponse(bingBlock("https://bing.test/a", "Bing Result", "bing 摘要"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("q", { apiKeys: { tavily: "k" } });

    expect(outcome.provider).toBe("bing");
    expect(outcome.results[0]?.title).toBe("Bing Result");
    const calls = fetchMock.mock.calls.map((call) => call[0]);
    expect(calls).toEqual([
      "https://api.tavily.com/search",
      expect.stringContaining("lite.duckduckgo.com"),
      expect.stringContaining("bing.com/search"),
    ]);
  });

  it("未配置 Key 时直接从 ddg 开始，不请求 API 供应商", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(ddgLtiePage([{ href: "https://a.test/x", title: "X", snippet: "s" }])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await searchWeb("q");

    expect(outcome.provider).toBe("ddg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全部来源失败抛汇总错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("", false, 403)));

    await expect(searchWeb("q")).rejects.toThrow(/全部来源失败/);
  });

  it("空查询直接抛错，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("   ")).rejects.toThrow("查询为空");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
