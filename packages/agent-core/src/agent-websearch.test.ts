import { afterEach, describe, expect, it, vi } from "vitest";

import { runWebSearch } from "./agent-websearch";

/**
 * DuckDuckGo HTML 搜索解析：
 * - result__a 链接抽取、标题去标签、uddg 重定向还原
 * - 跳过空标题 / 非 http(s) / 重复链接；最多 8 条
 * - HTTP 非 2xx 抛错
 */

function ddgResponse(html: string, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => html,
  } as unknown as Response;
}

function resultLink(href: string, title: string): string {
  return `<a class="result__a" href="${href}">${title}</a>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWebSearch", () => {
  it("解析 result__a 链接与标题，还原 uddg 重定向", async () => {
    const html = [
      resultLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage", "Example <b>Page</b>"),
      resultLink("https://direct.test/a", "Direct"),
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => ddgResponse(html)));

    const results = await runWebSearch("hello world");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: "Example Page", url: "https://example.com/page" });
    expect(results[1]).toMatchObject({ title: "Direct", url: "https://direct.test/a" });
    expect(results[0]?.id).toBeTruthy();
  });

  it("跳过空标题、非 http(s) 与重复链接，最多 8 条", async () => {
    const parts = [
      resultLink("https://dup.test/x", "Dup"),
      resultLink("https://dup.test/x", "Dup again"),
      resultLink("ftp://bad.test/f", "Bad scheme"),
      resultLink("https://ok.test/1", ""),
      resultLink("https://ok.test/2", "   "),
    ];
    for (let i = 0; i < 12; i += 1) {
      parts.push(resultLink(`https://many.test/${i}`, `Title ${i}`));
    }
    vi.stubGlobal("fetch", vi.fn(async () => ddgResponse(parts.join("\n"))));

    const results = await runWebSearch("query");

    expect(results).toHaveLength(8);
    expect(results[0]).toMatchObject({ url: "https://dup.test/x" });
    expect(results.some((item) => item.url.includes("bad.test"))).toBe(false);
    expect(results.some((item) => item.title === "")).toBe(false);
  });

  it("无结果时返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ddgResponse("<html>no results</html>")));

    await expect(runWebSearch("nothing")).resolves.toEqual([]);
  });

  it("HTTP 非 2xx 抛出 websearch HTTP 错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ddgResponse("", { ok: false, status: 503 })));

    await expect(runWebSearch("boom")).rejects.toThrow("websearch HTTP 503");
  });
});
