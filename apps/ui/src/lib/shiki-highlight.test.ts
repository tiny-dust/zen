import { describe, expect, it } from "vitest";

import { highlightLines, langFromPath } from "@/lib/shiki-highlight";

// 冒烟：shiki 双主题（--shiki-light/--shiki-dark）整段高亮后按行拆分的管线可用。
// 工具结果/diff 视图依赖每行 HTML；拆分失败会整体回落纯文本（高亮失效）。
describe("shiki-highlight", () => {
  it("langFromPath 按扩展名取语言；未知扩展名返回 undefined", () => {
    expect(langFromPath("src/main/app.ts")).toBe("typescript");
    expect(langFromPath("a/b/c.VUE")).toBe("vue");
    expect(langFromPath("D:\\x\\y\\script.py")).toBe("python");
    expect(langFromPath("notes.txt")).toBeUndefined();
    expect(langFromPath(undefined)).toBeUndefined();
  });

  it("highlightLines 返回每行 HTML 且带双主题变量", async () => {
    const lines = await highlightLines('const x = "hi";\n// done', "typescript");
    expect(lines).not.toBeNull();
    expect(lines).toHaveLength(2);
    // token 颜色走 --shiki-light / --shiki-dark 双变量（深浅主题切换由 CSS 取用）
    expect(lines![0]).toContain("--shiki-light");
    expect(lines![0]).toContain("--shiki-dark");
    // 行内无裸换行（避免 v-html 行错位）
    expect(lines![0]).not.toContain("\n");
  });

  it("空串返回 null（调用方保持纯文本）", async () => {
    expect(await highlightLines("", "typescript")).toBeNull();
  });
});
