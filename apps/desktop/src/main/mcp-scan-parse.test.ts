import { describe, expect, it } from "vitest";

import {
  asString,
  expandValue,
  extractServerMap,
  isRecord,
  parseJsonc,
  parseToml,
  toConfig,
  toEntryList,
} from "./mcp-scan-parse";

const ctx = { home: "/home/u", env: { HOME: "/home/u", TOKEN: "secret" } };

describe("isRecord / asString", () => {
  it("只认普通对象；数字/布尔转字符串，其他忽略", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(asString(3)).toBe("3");
    expect(asString(true)).toBe("true");
    expect(asString(false)).toBe("false");
    expect(asString(null)).toBeUndefined();
    expect(asString({})).toBeUndefined();
    expect(asString("")).toBe("");
  });
});

describe("parseJsonc 边角", () => {
  it("字符串内 // 与 /* */ 不会被当作注释；转义引号不破坏解析", () => {
    const data = parseJsonc(`{
      // 顶部注释
      "a": "http://x/y", /* 块注释 */
      "b": "he said \\"hi\\" // not comment",
      "c": ["x", /* mid */ "y",],
    }`) as Record<string, unknown>;
    expect(data["a"]).toBe("http://x/y");
    expect(data["b"]).toBe('he said "hi" // not comment');
    expect(data["c"]).toEqual(["x", "y"]);
  });

  it("单引号被当作字符串边界保护注释符；但单引号不是合法 JSON，parse 最终抛错", () => {
    // strip 阶段按单引号边界跳过注释符/尾逗号（覆盖 quote 分支），JSON.parse 阶段按标准抛错
    expect(() => parseJsonc(`{ 'a': 'x // y', 'b': 'z', }`)).toThrow();
  });
});

describe("parseToml 边角", () => {
  it("数组表 [[a]] 整段跳过；缺 key 的赋值跳过；行内 = 在引号内不算赋值", () => {
    const data = parseToml(`
[[mcp_servers.x]]
command = "ignored"
= "no-key"
url = "a=b"
key = 'has = sign'
`);
    // [[...]] 段被跳过：顶层不出现 mcp_servers
    expect(data["mcp_servers"]).toBeUndefined();
    expect(data["url"]).toBe("a=b");
    expect(data["key"]).toBe("has = sign");
  });

  it("带引号 key 路径、转义字符与多行数组/内联表", () => {
    const data = parseToml(`
["mcp.servers".env]
"a.b" = "v"
[mcp_servers.deep]
args = [
  "--x", # 注释
  "y",
]
inline = { a = 1, b = "two", c = [true, false], d = { e = "f" } }
bad = [1,
broken = "after-bad-array"
`); // 数组未闭合 → 后续行按深度吸收，值容错为 undefined
    // "mcp.servers" 是带引号的单层键名（引号内 . 不分层）
    const mcpServers = data["mcp.servers"] as Record<string, Record<string, unknown>>;
    expect(mcpServers["env"]?.["a.b"]).toBe("v");
    const servers = data["mcp_servers"] as Record<string, Record<string, unknown>>;
    expect(servers["deep"]?.["args"]).toEqual(["--x", "y"]);
    expect(servers["deep"]?.["inline"]).toEqual({
      a: 1,
      b: "two",
      c: [true, false],
      d: { e: "f" },
    });
  });

  it("值类型：布尔/整数/浮点/负数/单引号字面串/转义序列；非法值返回 undefined", () => {
    const data = parseToml(`
t = true
f = false
i = 42
fl = -3.5
lit = 'no \\n escape'
esc = "line\\nbreak \\u0041 \\q"
bad = some-unquoted
empty = 
`);
    expect(data["t"]).toBe(true);
    expect(data["f"]).toBe(false);
    expect(data["i"]).toBe(42);
    expect(data["fl"]).toBe(-3.5);
    expect(data["lit"]).toBe("no \\n escape");
    expect(data["esc"]).toBe("line\nbreak A q");
    expect(data["bad"]).toBeUndefined();
    expect("empty" in data).toBe(false);
  });

  it("未闭合字符串/数组/内联表 → undefined", () => {
    const data = parseToml(`
a = "unterminated
b = [1, 2
c = { x = 1
`);
    expect(data["a"]).toBeUndefined();
    expect(data["b"]).toBeUndefined();
    expect(data["c"]).toBeUndefined();
  });
});

describe("extractServerMap / toEntryList", () => {
  it("mapAt 显式路径：逐层下钻，中途非对象返回空", () => {
    expect(extractServerMap({ a: { b: { s: { x: {} } } } }, ["a", "b", "s"])).toEqual({
      x: {},
    });
    expect(extractServerMap({ a: 1 }, ["a", "b"])).toEqual({});
    expect(extractServerMap(null, ["a"])).toEqual({});
  });

  it("无 mapAt：mcpServers/servers/mcp 键优先，数组形态按 name 归集，否则退顶层", () => {
    expect(extractServerMap({ mcpServers: { a: {} } })).toEqual({ a: {} });
    expect(extractServerMap({ servers: { b: {} } })).toEqual({ b: {} });
    expect(extractServerMap({ mcp: [{ name: "c", url: "u" }, { noname: 1 }, 3] })).toEqual({
      c: { name: "c", url: "u" },
    });
    expect(extractServerMap({ fallback: {} })).toEqual({ fallback: {} });
    expect(extractServerMap(3)).toEqual({});
  });

  it("toEntryList 跳过标量/数组垃圾项", () => {
    expect(toEntryList({ a: { x: 1 }, b: "str", c: [1], d: { y: 2 } })).toEqual([
      ["a", { x: 1 }],
      ["d", { y: 2 }],
    ]);
  });
});

describe("expandValue", () => {
  it("~ 与 ~/ 前缀展开为 home；${VAR} 展开环境变量，未定义保持原样", () => {
    expect(expandValue("~", ctx)).toBe("/home/u");
    expect(expandValue("~/bin/srv", ctx)).toBe("/home/u/bin/srv");
    expect(expandValue("${HOME}/x", ctx)).toBe("/home/u/x");
    expect(expandValue("${TOKEN}", ctx)).toBe("secret");
    expect(expandValue("${NOPE}/y", ctx)).toBe("${NOPE}/y");
    expect(expandValue("~user/z", ctx)).toBe("~user/z");
    expect(expandValue("$HOME", ctx)).toBe("$HOME");
  });
});

describe("toConfig 归一", () => {
  it("MiMo command 数组形态：首元素为命令，其余并入 args", () => {
    const config = toConfig("id1", "mimo", {
      type: "local",
      command: ["npx", "-y", "srv"],
      args: ["--x"],
      environment: { A: "1" },
    });
    expect(config).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv", "--x"],
      env: { A: "1" },
      enabled: true,
    });
  });

  it("type=local 无 command → null；无 command 无 url → null", () => {
    expect(toConfig("id1", "x", { type: "local" })).toBeNull();
    expect(toConfig("id1", "x", { type: "remote" })).toBeNull();
    expect(toConfig("id1", "x", {})).toBeNull();
  });

  it("URL 形态判传输：sseUrl/type=sse → sse；/sse 结尾 → sse；其余 → http", () => {
    expect(toConfig("id", "a", { sseUrl: "https://x/sse" })?.transport).toBe("sse");
    expect(toConfig("id", "a", { type: "sse", url: "https://x/mcp" })?.transport).toBe("sse");
    expect(
      toConfig("id", "a", { type: "streamable-http", url: "https://x/mcp" })?.transport,
    ).toBe("http");
    expect(
      toConfig("id", "a", { type: "streamable_http", url: "https://x/mcp" })?.transport,
    ).toBe("http");
    expect(toConfig("id", "a", { url: "https://x/sse" })?.transport).toBe("sse");
    expect(toConfig("id", "a", { url: "https://x/sse?v=1" })?.transport).toBe("sse");
    expect(toConfig("id", "a", { url: "https://x/mcp" })?.transport).toBe("http");
  });

  it("authorizationToken 注入 Authorization 头；enabled=false 透传；展开作用于 url/env/headers/command/args", () => {
    const config = toConfig(
      "id",
      "a",
      {
        url: "${HOME}/mcp",
        headers: { "X-Key": "${TOKEN}" },
        authorizationToken: "tk",
        environment: { P: "~/p" },
        enabled: false,
      },
      ctx,
    );
    expect(config).toMatchObject({
      url: "/home/u/mcp",
      headers: { "X-Key": "secret", Authorization: "Bearer tk" },
      enabled: false,
    });

    const stdio = toConfig(
      "id",
      "b",
      { command: "~/bin/run", args: ["${TOKEN}"], env: { Q: "1" } },
      ctx,
    );
    expect(stdio).toMatchObject({
      command: "/home/u/bin/run",
      args: ["secret"],
      env: { Q: "1" },
    });

    // 无展开上下文时原样保留
    expect(toConfig("id", "c", { command: "~/bin/run" })).toMatchObject({
      command: "~/bin/run",
    });
    // 空 env/headers 不落字段
    expect(toConfig("id", "d", { command: "run", env: {}, headers: {} })).not.toHaveProperty(
      "env",
    );
    expect(toConfig("id", "e", { url: "https://x/mcp", headers: {} })).not.toHaveProperty(
      "headers",
    );
  });
});
