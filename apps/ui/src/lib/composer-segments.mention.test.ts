import { describe, expect, it } from "vitest";

import { parseSegments } from "@/lib/composer-segments";

// 回归：@/$ 弹层打开期间的输入中 token 不做引用装饰（纯文本），
// 选中落定（apply 插入完整 `$路径 `）后才变 tag——「没选中就变 tag」的纠偏。
describe("parseSegments 的 excludeMention（输入中提及不装饰）", () => {
  it("弹层打开时范围内的提及保持纯文本", () => {
    const source = "看下 @src/foo";
    // @src/foo 起点为 3（「看下 」占 3 字符），终点 11
    const segments = parseSegments(source, [], undefined, { start: 3, end: 11 });
    expect(segments.some((segment) => segment.kind === "token")).toBe(false);
    expect(segments.map((segment) => segment.text).join("")).toBe(source);
  });

  it("范围外（已落定）的提及仍正常装饰", () => {
    const segments = parseSegments("$done.md 看下 @src/foo", [], undefined, { start: 14, end: 22 });
    const tokens = segments.filter((segment) => segment.kind === "token");
    // $done.md 已落定 → 仍是 token；@src/foo 在排除范围内 → 纯文本
    expect(tokens.map((segment) => segment.text)).toEqual(["$done.md"]);
  });

  it("exclude 为空（弹层关闭）时恢复装饰", () => {
    const segments = parseSegments("看下 @src/foo", [], undefined, null);
    expect(segments.some((segment) => segment.kind === "token")).toBe(true);
  });

  it("排除范围只覆盖部分重叠的提及时仍不装饰该提及", () => {
    const segments = parseSegments("看下 @src/foo", [], undefined, { start: 5, end: 11 });
    expect(segments.some((segment) => segment.kind === "token")).toBe(false);
  });
});
