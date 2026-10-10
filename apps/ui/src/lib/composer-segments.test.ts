import { describe, expect, it } from "vitest";

import { parseSegments, snapToToken } from "@/lib/composer-segments";

describe("parseSegments 的 mcp 分段", () => {
  it("解析单个 #mcp:服务.工具 引用", () => {
    const segments = parseSegments("看下 #mcp:mobbin.search_apps 的结果", [], undefined);
    const mcp = segments.filter((segment) => segment.kind === "mcp");
    expect(mcp).toHaveLength(1);
    expect(mcp[0]?.text).toBe("#mcp:mobbin.search_apps");
  });

  it("与技能、附件引用 token 同段共存互不吞并", () => {
    const segments = parseSegments("#mcp:a.b /skill:x $file.md", [], undefined);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "mcp",
      "text",
      "skill",
      "text",
      "token",
    ]);
    expect(segments.map((segment) => segment.text)).toEqual([
      "#mcp:a.b",
      " ",
      "/skill:x",
      " ",
      "$file.md",
    ]);
  });

  it("区间已被先到的分段占用时不再产生 mcp 分段（先到先得）", () => {
    const segments = parseSegments("/skill:#mcp:a.b", [], undefined);
    expect(segments.some((segment) => segment.kind === "mcp")).toBe(false);
    expect(segments.some((segment) => segment.kind === "skill")).toBe(true);
  });

  it("普通 # / #5 / 空的 #mcp: 不产生 mcp 分段", () => {
    const segments = parseSegments("普通 # 和 #5 还有 #mcp: 都不算", [], undefined);
    expect(segments.some((segment) => segment.kind === "mcp")).toBe(false);
  });

  it("多个 mcp 引用同时解析", () => {
    const segments = parseSegments("用 #mcp:a.search 和 #mcp:b.fetch 查", [], undefined);
    const mcp = segments.filter((segment) => segment.kind === "mcp");
    expect(mcp.map((segment) => segment.text)).toEqual(["#mcp:a.search", "#mcp:b.fetch"]);
  });
});

describe("snapToToken 对 mcp 分段的吸附", () => {
  it("偏移落在分段内部时吸附到起点/终点，nearest 就近，与 skill 语义一致", () => {
    const mcpSegments = parseSegments("前 #mcp:a.b 后", [], undefined);
    expect(snapToToken(mcpSegments, 5, "start")).toBe(2);
    expect(snapToToken(mcpSegments, 5, "end")).toBe(10);
    expect(snapToToken(mcpSegments, 3, "nearest")).toBe(2);
    expect(snapToToken(mcpSegments, 9, "nearest")).toBe(10);

    const skillSegments = parseSegments("前 /skill:x 后", [], undefined);
    expect(snapToToken(skillSegments, 5, "start")).toBe(2);
    expect(snapToToken(skillSegments, 5, "end")).toBe(10);
  });
});
