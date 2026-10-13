import { describe, expect, it } from "vitest";

import {
  createCliLineSplitter,
  encodeCliResponse,
  isAuthorized,
  parseCliLine,
} from "./cli-protocol";

describe("parseCliLine", () => {
  it("合法请求解析出 token / command / args", () => {
    const result = parseCliLine(
      '{"token":"abc","command":"ask","args":{"workspacePath":"/tmp","message":"hi"}}',
    );
    expect(result).toEqual({
      ok: true,
      request: { token: "abc", command: "ask", args: { workspacePath: "/tmp", message: "hi" } },
    });
  });

  it("args 缺省时补空对象；容忍首尾空白", () => {
    const result = parseCliLine('  {"token":"abc","command":"ping"}  ');
    expect(result).toEqual({
      ok: true,
      request: { token: "abc", command: "ping", args: {} },
    });
  });

  it("空行 / 非 JSON / 非对象一律拒绝", () => {
    expect(parseCliLine("").ok).toBe(false);
    expect(parseCliLine("   ").ok).toBe(false);
    expect(parseCliLine("not json").ok).toBe(false);
    expect(parseCliLine("123").ok).toBe(false);
    expect(parseCliLine('"string"').ok).toBe(false);
  });

  it("缺 token / 未知 command / args 非对象拒绝并给出原因", () => {
    expect(parseCliLine('{"command":"ping"}')).toEqual({ ok: false, error: "missing token" });
    expect(parseCliLine('{"token":"t","command":"rm -rf"}')).toEqual({
      ok: false,
      error: expect.stringContaining("unknown command"),
    });
    expect(parseCliLine('{"token":"t","command":"ping","args":[1]}')).toEqual({
      ok: false,
      error: "args must be an object",
    });
  });
});

describe("isAuthorized", () => {
  const request = { token: "secret", command: "ping" as const, args: {} };
  it("token 匹配通过", () => {
    expect(isAuthorized(request, "secret")).toBe(true);
  });
  it("token 不匹配拒绝", () => {
    expect(isAuthorized(request, "other")).toBe(false);
  });
});

describe("encodeCliResponse", () => {
  it("单行 JSON + 换行结尾", () => {
    expect(encodeCliResponse({ ok: true })).toBe('{"ok":true}\n');
    expect(encodeCliResponse({ ok: false, error: "x" })).toBe('{"ok":false,"error":"x"}\n');
  });
});

describe("createCliLineSplitter", () => {
  it("半行跨 chunk 缓冲，完整后输出", () => {
    const split = createCliLineSplitter();
    expect(split('{"token":"a",')).toEqual([]);
    expect(split('"command":"ping"}\n')).toEqual(['{"token":"a","command":"ping"}']);
  });

  it("多行粘包一次拆出，容忍 \\r\\n", () => {
    const split = createCliLineSplitter();
    expect(split('{"a":1}\n{"b":2}\r\n{"c":3}\n')).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("空行不产出", () => {
    const split = createCliLineSplitter();
    expect(split("\n\n")).toEqual([]);
  });
});
