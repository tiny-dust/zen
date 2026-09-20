import { describe, expect, it } from "vitest";

import { normalizeBrowserUrl } from "@/stores/browser";

describe("normalizeBrowserUrl", () => {
  it("keeps absolute urls", () => {
    expect(normalizeBrowserUrl("https://www.baidu.com/")).toBe("https://www.baidu.com/");
  });

  it("adds https for bare domains", () => {
    expect(normalizeBrowserUrl("www.baidu.com")).toBe("https://www.baidu.com");
    expect(normalizeBrowserUrl("github.com/zen")).toBe("https://github.com/zen");
  });

  it("adds http for localhost", () => {
    expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserUrl("127.0.0.1:3000/app")).toBe("http://127.0.0.1:3000/app");
  });

  it("falls back to search for non-url text", () => {
    expect(normalizeBrowserUrl("百度")).toBe(
      "https://www.bing.com/search?q=%E7%99%BE%E5%BA%A6",
    );
    expect(normalizeBrowserUrl("electron webcontentsview")).toBe(
      "https://www.bing.com/search?q=electron%20webcontentsview",
    );
  });

  it("returns empty for blank", () => {
    expect(normalizeBrowserUrl("   ")).toBe("");
  });
});
