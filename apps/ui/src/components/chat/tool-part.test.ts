import { describe, expect, it } from "vitest";

import { toolDisplay, toolStateLabel, toolStatusLine } from "@/components/chat/tool-part";

describe("toolDisplay", () => {
  it("浏览器工具映射为中文 label", () => {
    expect(toolDisplay("browserStatus", {})).toMatchObject({ label: "查看浏览器状态" });
    expect(toolDisplay("browserSnapshot", {})).toMatchObject({ label: "截取页面结构" });
    expect(toolDisplay("browserExtract", {})).toMatchObject({ label: "提取页面元素" });
    expect(toolDisplay("browserConsole", {})).toMatchObject({ label: "读取控制台" });
    expect(toolDisplay("browserPerformance", {})).toMatchObject({ label: "性能分析" });
    expect(toolDisplay("browserScreenshot", {})).toMatchObject({ label: "页面截图" });
  });

  it("浏览器工具带目标文本", () => {
    expect(toolDisplay("browserOpen", { url: "http://127.0.0.1:5173" })).toMatchObject({
      label: "打开页面",
      target: { kind: "text", text: "http://127.0.0.1:5173" },
    });
    expect(toolDisplay("browserClick", { selector: "#submit" })).toMatchObject({
      label: "点击元素",
      target: { kind: "text", text: "#submit" },
    });
    expect(toolDisplay("browserType", { selector: "input[name=q]", text: "hi" })).toMatchObject({
      label: "输入文本",
      target: { kind: "text", text: "input[name=q]" },
    });
    expect(toolDisplay("browserEvaluate", { expression: "1 + 1" })).toMatchObject({
      label: "执行脚本",
      target: { kind: "text", text: "1 + 1" },
    });
  });
});

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
