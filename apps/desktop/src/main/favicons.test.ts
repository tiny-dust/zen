import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSiteFavicon, siteOriginOf } from "./favicons";

/**
 * 站点图标抓取：/favicon.ico → 页面声明的 <link rel=icon>、失败缓存不重复打网络、
 * 非 http(s) 直接不抓。内存缓存是模块级的，所以每个用例换不同站点源，互不污染。
 */

let cacheDir = "";

function dir(): string {
  if (!cacheDir) {
    cacheDir = mkdtempSync(join(tmpdir(), "zen-favicons-"));
  }
  return cacheDir;
}

afterEach(() => {
  if (cacheDir) {
    rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = "";
  }
  vi.restoreAllMocks();
});

function imageResponse(bytes: number[], type = "image/png"): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": type },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
}

function notFound(): Response {
  return new Response("nope", { status: 404 });
}

function dataUrlOf(bytes: number[]): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("siteOriginOf", () => {
  it("只接受 http(s)，宿主小写；其余返回空串", () => {
    expect(siteOriginOf("https://WWW.Example.com/a")).toBe("https://www.example.com");
    expect(siteOriginOf("http://10.0.0.2:8080/a")).toBe("http://10.0.0.2:8080");
    expect(siteOriginOf("file:///tmp/a.html")).toBe("");
    expect(siteOriginOf("about:blank")).toBe("");
    expect(siteOriginOf("")).toBe("");
  });
});

describe("fetchSiteFavicon", () => {
  it("根目录 /favicon.ico 命中：转成 data URL 并只请求一次（第二次命中缓存）", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL) => imageResponse([1, 2, 3]));

    const first = await fetchSiteFavicon("https://favicon-ok.example.com/page", {
      cacheDir: dir(),
      fetchImpl: fetchImpl as never,
    });
    expect(first).toBe(dataUrlOf([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://favicon-ok.example.com/favicon.ico");

    const second = await fetchSiteFavicon("https://favicon-ok.example.com/page", {
      cacheDir: dir(),
      fetchImpl: fetchImpl as never,
    });
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("没有 /favicon.ico 但有 <link rel=icon>：用页面声明的地址", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/favicon.ico")) {
        return notFound();
      }
      if (url.replace(/\/$/, "") === "https://favicon-link.example.com") {
        return htmlResponse(
          '<html><head><link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/static/logo.png"></head></html>',
        );
      }
      if (url === "https://favicon-link.example.com/static/logo.png") {
        return imageResponse([7, 8]);
      }
      return notFound();
    });

    const result = await fetchSiteFavicon("https://favicon-link.example.com/docs/page", {
      cacheDir: dir(),
      fetchImpl: fetchImpl as never,
    });
    expect(result).toBe(dataUrlOf([7, 8]));
  });

  it("站点没有图标（404）：返回 null，并缓存失败结果不再重试", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL) => notFound());
    const url = "https://favicon-404.example.com/a";

    expect(await fetchSiteFavicon(url, { cacheDir: dir(), fetchImpl: fetchImpl as never })).toBeNull();
    const calls = fetchImpl.mock.calls.length;
    expect(await fetchSiteFavicon(url, { cacheDir: dir(), fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it("返回非图片内容（登录页 HTML）视为没有图标", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL) => htmlResponse("<html></html>"));
    expect(
      await fetchSiteFavicon("https://favicon-html.example.com/x", {
        cacheDir: dir(),
        fetchImpl: fetchImpl as never,
      }),
    ).toBeNull();
  });

  it("http 站点原协议失败时回退 https", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) =>
      String(input).startsWith("https://")
        ? imageResponse([9])
        : new Response("boom", { status: 500 }),
    );
    const result = await fetchSiteFavicon("http://favicon-fallback.example.com/a", {
      cacheDir: dir(),
      fetchImpl: fetchImpl as never,
    });
    expect(result).toBe(dataUrlOf([9]));
    expect(
      fetchImpl.mock.calls.some((call) =>
        String(call[0]).startsWith("https://favicon-fallback.example.com/favicon.ico"),
      ),
    ).toBe(true);
  });

  it("非 http(s) 地址不发起请求", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL) => imageResponse([1]));
    expect(
      await fetchSiteFavicon("file:///tmp/a.html", { cacheDir: dir(), fetchImpl: fetchImpl as never }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("超大响应（不是图标）不采用", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL) =>
      imageResponse(new Array(300 * 1024).fill(0)),
    );
    expect(
      await fetchSiteFavicon("https://favicon-huge.example.com/a", {
        cacheDir: dir(),
        fetchImpl: fetchImpl as never,
      }),
    ).toBeNull();
  });
});
