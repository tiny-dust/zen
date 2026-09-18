import { describe, expect, it } from "vitest";

import { classifyPathRef, normalizePathRef } from "./path-ref";

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
