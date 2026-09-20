import { describe, expect, it } from "vitest";

import { toolStateLabel, toolStatusLine } from "@/components/chat/tool-part";

describe("toolStateLabel", () => {
  it("覆盖全部 ToolCallState 中文状态词", () => {
    expect(toolStateLabel("input-streaming")).toBe("准备参数");
    expect(toolStateLabel("awaiting-approval")).toBe("待审批");
    expect(toolStateLabel("running")).toBe("执行中");
    expect(toolStateLabel("running", 42)).toBe("42%");
    expect(toolStateLabel("ok")).toBe("完成");
    expect(toolStateLabel("denied")).toBe("已拒绝");
    expect(toolStateLabel("error")).toBe("失败");
    expect(toolStateLabel("cancelled")).toBe("已取消");
    expect(toolStateLabel("interrupted")).toBe("已中断");
    expect(toolStateLabel(undefined)).toBe("未知");
  });
});

describe("toolStatusLine", () => {
  it("过程态用 message，终态用原因/摘要", () => {
    expect(toolStatusLine({ state: "running", message: "写入中" })).toBe("写入中");
    expect(toolStatusLine({ state: "awaiting-approval" })).toBe("等待审批");
    expect(toolStatusLine({ state: "cancelled", error: "用户取消" })).toBe("用户取消");
    expect(toolStatusLine({ state: "interrupted" })).toBe("已中断，未完成");
    expect(toolStatusLine({ state: "denied", error: "不要执行" })).toBe("不要执行");
    expect(toolStatusLine({ state: "ok", summary: "已写入 a.ts" })).toBe("已写入 a.ts");
  });
});
