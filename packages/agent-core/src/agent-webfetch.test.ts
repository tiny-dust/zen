import { afterEach, describe, expect, it, vi } from "vitest";

import { runWebFetch } from "./agent-webfetch";

/**
 * 页面阅读（webFetch）：
 * - HTML → Readability 正文 → markdown；非文章页退化纯文本
 * - 长页按字符分页（startIndex / nextStartIndex / totalChars）
 * - 直抓失败回落 r.jina.ai reader；不支持 http(s) 之外的协议
 */

function response(init: { body: string; contentType: string; ok?: boolean; status?: number }): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ "content-type": init.contentType }),
    text: async () => init.body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWebFetch", () => {
  it("HTML 文章抽取为 markdown，并支持分页续读", async () => {
    const article = [
      "<html><head><title>文章标题</title></head><body>",
      "<nav>菜单导航</nav>",
      "<article><h1>核心标题</h1>",
      `<p>${"正文内容。".repeat(200)}</p>`,
      "</article></body></html>",
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ body: article, contentType: "text/html; charset=utf-8" })),
    );

    const first = await runWebFetch("https://example.com/a", { maxChars: 500 });

    expect(first.title).toBe("文章标题");
    expect(first.content).toContain("# 核心标题");
    expect(first.content.length).toBe(500);
    expect(first.totalChars).toBeGreaterThan(500);
    expect(first.nextStartIndex).toBe(500);

    const rest = await runWebFetch("https://example.com/a", {
      startIndex: first.nextStartIndex ?? 0,
      maxChars: 50_000,
    });
    expect(rest.startIndex).toBe(500);
    expect(rest.nextStartIndex).toBeNull();
    expect(rest.totalChars).toBe(first.totalChars);
  });

  it("纯文本内容直接透传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ body: "# 指南\n内容主体", contentType: "text/plain" })),
    );

    const result = await runWebFetch("https://example.com/readme.txt");

    expect(result.content).toBe("# 指南\n内容主体");
    expect(result.nextStartIndex).toBeNull();
  });

  it("直抓非 2xx 回落 r.jina.ai reader", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://blocked.test/page") {
        return response({ body: "", contentType: "text/html", ok: false, status: 403 });
      }
      expect(url).toBe("https://r.jina.ai/https://blocked.test/page");
      return response({
        body: "Title: 镜像标题\n\nURL Source: https://blocked.test/page\n\nMarkdown Content:\n# 镜像正文",
        contentType: "text/plain",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebFetch("https://blocked.test/page");

    expect(result.title).toBe("镜像标题");
    expect(result.content).toBe("# 镜像正文");
  });

  it("直抓与 reader 都失败抛汇总错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ body: "", contentType: "text/html", ok: false, status: 500 })));

    await expect(runWebFetch("https://down.test/x")).rejects.toThrow(/直抓失败.*reader 兜底失败/s);
  });

  it("拒绝非 http(s) 协议", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runWebFetch("file:///etc/passwd")).rejects.toThrow("仅支持 http(s)");
    await expect(runWebFetch("ftp://example.com/x")).rejects.toThrow("仅支持 http(s)");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
