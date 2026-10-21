// 异常上报采集的纯函数：节流 / reason 归一 / window-error 分类 / Vue 错误载荷。
import { describe, expect, it, vi } from "vitest";

import {
  describeReason,
  payloadFromErrorEvent,
  payloadFromVueError,
  shouldReportMessage,
} from "@/lib/error-reporter";

describe("shouldReportMessage 节流", () => {
  it("5 秒窗口内相同 message 只放行一次，不同 message 互不影响", () => {
    const seen = new Map<string, number>();
    expect(shouldReportMessage(seen, "boom", 1_000)).toBe(true);
    expect(shouldReportMessage(seen, "boom", 3_000)).toBe(false);
    expect(shouldReportMessage(seen, "bang", 3_000)).toBe(true);
    // 窗口外再次放行
    expect(shouldReportMessage(seen, "boom", 6_100)).toBe(true);
  });

  it("自定义窗口宽度生效", () => {
    const seen = new Map<string, number>();
    expect(shouldReportMessage(seen, "boom", 0, 100)).toBe(true);
    expect(shouldReportMessage(seen, "boom", 99, 100)).toBe(false);
    expect(shouldReportMessage(seen, "boom", 100, 100)).toBe(true);
  });
});

describe("describeReason 归一 unhandledrejection reason", () => {
  it("Error 取 message/stack", () => {
    const error = new Error("network down");
    expect(describeReason(error)).toEqual({ message: "network down", stack: error.stack });
  });

  it("字符串原样，其它安全 String 化", () => {
    expect(describeReason("raw text")).toEqual({ message: "raw text" });
    expect(describeReason(42).message).toBe("42");
  });
});

describe("payloadFromErrorEvent 分类", () => {
  it("target 是元素 → resource-error，消息含资源地址", () => {
    const img = document.createElement("img");
    img.src = "https://example.com/logo.png";
    const event = { target: img } as unknown as Event;
    const payload = payloadFromErrorEvent(event);
    expect(payload.kind).toBe("resource-error");
    expect(payload.message).toContain("logo.png");
  });

  it("target 是 window → window-error，携带 message/stack", () => {
    const error = new Error("x is not defined");
    const event = { target: window, message: "Uncaught Error: x is not defined", error } as unknown as Event;
    const payload = payloadFromErrorEvent(event);
    expect(payload.kind).toBe("window-error");
    expect(payload.message).toBe("Uncaught Error: x is not defined");
    expect(payload.stack).toBe(error.stack);
  });

  it("无 message 兜底未知错误", () => {
    const event = { target: window } as unknown as Event;
    expect(payloadFromErrorEvent(event).message).toBeTruthy();
  });
});

describe("payloadFromVueError 组装", () => {
  it("kind=vue，消息含 err.message 与错误信息标注", () => {
    const error = new Error("render failed");
    const payload = payloadFromVueError(error, null, "render function");
    expect(payload.kind).toBe("vue");
    expect(payload.message).toContain("render failed");
    expect(payload.message).toContain("render function");
    expect(payload.stack).toBe(error.stack);
  });

  it("非 Error 的 err 安全 String 化", () => {
    const payload = payloadFromVueError("plain string", null, "");
    expect(payload.message).toBe("plain string");
    expect(payload.stack).toBeUndefined();
  });
});

describe("installErrorReporter 上报链路静默", () => {
  it("window error 事件 fire-and-forget 上报，zen 缺失不抛错", async () => {
    vi.stubGlobal("zen", { errors: { report: vi.fn(async () => ({ ok: true })) } });
    const { installErrorReporter } = await import("@/lib/error-reporter");
    const app = { config: {} } as never;
    expect(() => installErrorReporter(app)).not.toThrow();
    const error = new Error("dispatch boom");
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Uncaught Error: dispatch boom", error }),
    );
    expect(window.zen?.errors?.report).toHaveBeenCalledWith({
      kind: "window-error",
      message: "Uncaught Error: dispatch boom",
      stack: error.stack,
    });
    vi.unstubAllGlobals();
  });
});
