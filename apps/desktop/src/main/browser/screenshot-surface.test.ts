import { describe, expect, it } from "vitest";

import { canCaptureSurface, screenshotFailureMessage } from "./browser-utils";

describe("截图前的可截表面判断", () => {
  it("可见且尺寸非 0 才允许截图", () => {
    expect(canCaptureSurface(true, { width: 800, height: 600 })).toBe(true);
  });

  it("隐藏、无视图、尺寸为 0 或 1px 都判定为不可截", () => {
    expect(canCaptureSurface(false, { width: 800, height: 600 })).toBe(false);
    expect(canCaptureSurface(true, null)).toBe(false);
    expect(canCaptureSurface(true, { width: 0, height: 600 })).toBe(false);
    expect(canCaptureSurface(true, { width: 1, height: 1 })).toBe(false);
  });
});

describe("截图失败提示", () => {
  it("给出可操作步骤并保留原始错误", () => {
    const message = screenshotFailureMessage("UnknownVizError");
    expect(message).toContain("切到前台");
    expect(message).toContain("浏览器面板已展开");
    expect(message).toContain("UnknownVizError");
  });

  it("没有原始错误时不追加括号", () => {
    expect(screenshotFailureMessage("")).not.toContain("原始错误");
  });
});
