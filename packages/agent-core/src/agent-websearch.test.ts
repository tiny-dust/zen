import { afterEach, describe, expect, it, vi } from "vitest";

import { runWebSearch } from "./agent-websearch";

/**
 * Bing HTML 搜索解析：
 * - b_algo 结果块抽取、标题去标签、ck/a 重定向解码
 * - 跳过空标题 / 非 http(s) / 重复链接；最多 8 条
 * - HTTP 非 2xx 抛错
 */

function bingResponse(html: string, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => html,
  } as unknown as Response;
}

function redirectHref(target: string): string {
  const encoded = Buffer.from(target, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `https://www.bing.com/ck/a?!&amp;p=x&amp;u=${encoded}&amp;ntb=1`;
}

function resultBlock(href: string, title: string): string {
  return `<li class="b_algo"><h2><a target="_blank" href="${href}">${title}</a></h2></li>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWebSearch", () => {
  it("解析 b_algo 链接与标题，还原 ck/a 重定向", async () => {
    const html = [
      resultBlock(redirectHref("https://example.com/page"), "Example <b>Page</b>"),
      resultBlock("https://direct.test/a", "Direct"),
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => bingResponse(html)));

    const results = await runWebSearch("hello world");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: "Example Page", url: "https://example.com/page" });
    expect(results[1]).toMatchObject({ title: "Direct", url: "https://direct.test/a" });
    expect(results[0]?.id).toBeTruthy();
  });

  it("跳过空标题、非 http(s) 与重复链接，最多 8 条", async () => {
    const parts = [
      resultBlock("https://dup.test/x", "Dup"),
      resultBlock("https://dup.test/x", "Dup again"),
      resultBlock("ftp://bad.test/f", "Bad scheme"),
      resultBlock("https://ok.test/1", ""),
      resultBlock("https://ok.test/2", "   "),
    ];
    for (let i = 0; i < 12; i += 1) {
      parts.push(resultBlock(`https://many.test/${i}`, `Title ${i}`));
    }
    vi.stubGlobal("fetch", vi.fn(async () => bingResponse(parts.join("\n"))));

    const results = await runWebSearch("query");

    expect(results).toHaveLength(8);
    expect(results[0]).toMatchObject({ url: "https://dup.test/x" });
    expect(results.some((item) => item.url.includes("bad.test"))).toBe(false);
    expect(results.some((item) => item.title === "")).toBe(false);
  });

  it("无结果时返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bingResponse("<html>no results</html>")));

    await expect(runWebSearch("nothing")).resolves.toEqual([]);
  });

  it("HTTP 非 2xx 抛出 websearch HTTP 错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bingResponse("", { ok: false, status: 503 })));

    await expect(runWebSearch("boom")).rejects.toThrow("websearch HTTP 503");
  });
});
