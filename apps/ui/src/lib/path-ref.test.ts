import { describe, expect, it } from "vitest";

import { classifyPathRef, localFilePathFromHref, normalizePathRef } from "./path-ref";

describe("classifyPathRef", () => {
  it("识别相对/绝对/Windows 文件路径与行号", () => {
    expect(classifyPathRef("apps/ui/src/main.ts")).toBe("file");
    expect(classifyPathRef("./src/App.vue")).toBe("file");
    expect(classifyPathRef("C:\\repo\\src\\index.ts")).toBe("file");
    expect(classifyPathRef("package.json")).toBe("file");
    expect(classifyPathRef("src/store.ts:12")).toBe("file");
    expect(classifyPathRef("src/store.ts#L12")).toBe("file");
  });

  it("识别目录路径", () => {
    expect(classifyPathRef("apps/ui/src/")).toBe("dir");
    expect(classifyPathRef("packages/shared")).toBe("dir");
  });

  it("普通行内 code 不误判为路径", () => {
    expect(classifyPathRef("const x = 1")).toBe(null);
    expect(classifyPathRef("npm run typecheck")).toBe(null);
    expect(classifyPathRef("true")).toBe(null);
    expect(classifyPathRef("")).toBe(null);
    expect(classifyPathRef("x".repeat(241))).toBe(null);
  });
});

describe("normalizePathRef", () => {
  it("去掉行号后缀", () => {
    expect(normalizePathRef("src/a.ts:12")).toBe("src/a.ts");
    expect(normalizePathRef("src/a.ts#L12")).toBe("src/a.ts");
  });
});

describe("localFilePathFromHref", () => {
  it("接受相对路径和 file URL，并去掉行号/片段", () => {
    expect(localFilePathFromHref("src/App.vue:12")).toBe("src/App.vue");
    expect(localFilePathFromHref("App.vue:12")).toBe("App.vue");
    expect(localFilePathFromHref("../README")).toBe("../README");
    expect(localFilePathFromHref("/tmp/hello%20world.ts")).toBe("/tmp/hello world.ts");
    expect(localFilePathFromHref("file:///workspace/src/App.vue#L12")).toBe("/workspace/src/App.vue");
  });

  it("不拦截外链、锚点和不可识别文本", () => {
    expect(localFilePathFromHref("https://example.com/src/App.vue")).toBe(null);
    expect(localFilePathFromHref("mailto:test@example.com")).toBe(null);
    expect(localFilePathFromHref("#section")).toBe(null);
    expect(localFilePathFromHref("not a path")).toBe(null);
    for (const value of ['//host/a.ts', 'file://host/a.ts', 'ftp://host/a.ts', 'javascript:alert(1)', 'data:text/plain,a.ts', '/a.ts?download=1', '/bad%00.ts', '/bad%zz.ts']) {
      expect(localFilePathFromHref(value)).toBe(null);
    }
  });

  it.each([
    ['file:///tmp/a%2520b.ts', '/tmp/a%20b.ts'],
    ['file:///tmp/a%25b.ts', '/tmp/a%b.ts'],
    ['file:///tmp/a%23b.ts', '/tmp/a#b.ts'],
    ['file:///tmp/a%3Fb.ts', '/tmp/a?b.ts'],
    ['file:///tmp/a.ts%23L12', '/tmp/a.ts#L12'],
    ['src/a.ts%23L12', 'src/a.ts#L12'],
    ['src/报告.ts', 'src/报告.ts'],
    ['src/hello%20world.ts', 'src/hello world.ts'],
    ['src/hello world.ts#L12', 'src/hello world.ts'],
  ])('只解码一次并保留文件名：%s', (href, path) => {
    expect(localFilePathFromHref(href)).toBe(path);
  });

  it.each(['javascript%3Aalert(1)', '%2F%2Fhost/a.ts', '\\\\host\\a.ts', 'file:///tmp/bad%00.ts', 'file:///tmp/bad%zz.ts'])('拒绝危险或无效目标：%s', (href) => {
    expect(localFilePathFromHref(href)).toBe(null);
  });
});
