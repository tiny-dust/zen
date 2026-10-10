import { afterEach, describe, expect, it, vi } from "vitest";

import { McpHttpClient } from "./http";

import type { McpServerConfig } from "@zen/shared";

/**
 * 远程 MCP 双协议：
 * - streamable：POST JSON/SSE 响应、mcp-session-id 会话头、HTTP 错误包装
 * - legacy SSE：GET 流等 endpoint 事件（相对路径解析）、请求 POST 上报、响应走 SSE
 * - connect 校验 / shutdown 中止并拒绝挂起请求
 */

type FetchInit = { method?: string; headers?: Record<string, string>; body?: unknown };

function jsonRes(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

function textRes(text: string, headers: Record<string, string> = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => text,
    body: null,
  } as unknown as Response;
}

function sseRes(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      },
    }),
  } as unknown as Response;
}

function echoId(body: unknown, result: unknown): Response {
  const parsed = JSON.parse(String(body)) as { id?: number };
  return jsonRes({ jsonrpc: "2.0", id: parsed.id, result }, { "mcp-session-id": "sess-abc" });
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "remote",
    name: "remote-server",
    transport: "http",
    url: "http://mcp.test/rpc",
    enabled: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpHttpClient streamable", () => {
  it("202 + JSON null 的通知响应不杀伤在途请求（mobbin 实测竞态）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: FetchInit) => {
        const method = (JSON.parse(String(init.body)) as { method?: string }).method;
        if (method === "initialize") {
          return jsonRes({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "mobbin" } },
          });
        }
        if (method === "notifications/initialized") {
          // mobbin 实测：202 + application/json + body "null"；慢于 tools/list 到达
          await new Promise((resolve) => setTimeout(resolve, 20));
          return textRes("null", { "content-type": "application/json" }, 202);
        }
        // tools/list 更晚返回，期间通知的 202 null 已经派发
        await new Promise((resolve) => setTimeout(resolve, 60));
        return jsonRes({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search_screens" }] } });
      }),
    );

    const client = new McpHttpClient(config());
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["search_screens"]);
    expect(client.error).toBeNull();
  });

  it("initialize 记录会话 id，后续请求带 MCP-Session-Id", async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: FetchInit) => {
        calls.push({ url: String(url), init });
        const method = (JSON.parse(String(init.body)) as { method?: string }).method;
        if (method === "initialize") {
          return echoId(init.body, { serverInfo: { name: "fake" } });
        }
        return textRes("", {}, 202);
      }),
    );

    const client = new McpHttpClient(config());
    await client.connect();

    expect(client.isConnected).toBe(true);
    expect(client.name).toBe("remote-server");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers ?? {})["Content-Type"]).toBe("application/json");
    // initialized 通知也带上了会话 id
    const notify = calls.find((call) => String(call.init.body).includes("notifications/initialized"));
    expect(notify).toBeTruthy();
    expect((notify?.init.headers ?? {})["MCP-Session-Id"]).toBe("sess-abc");
  });

  it("callTool 经 JSON 响应返回文本；SSE 响应按帧分发（垃圾帧忽略）", async () => {
    let mode: "json" | "sse" = "json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: FetchInit) => {
        const parsed = JSON.parse(String(init.body)) as { id?: number; method?: string };
        if (parsed.method === "initialize") {
          return echoId(init.body, {});
        }
        if (parsed.method === "notifications/initialized") {
          return textRes("", {}, 202);
        }
        if (mode === "json") {
          return echoId(init.body, { content: [{ type: "text", text: "json 结果" }] });
        }
        return sseRes([
          "data: not-json\n\n",
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { content: [{ type: "text", text: "sse 结果" }] },
          })}\n\n`,
        ]);
      }),
    );

    const client = new McpHttpClient(config());
    await client.connect();
    await expect(client.callTool("send", { a: 1 })).resolves.toEqual({
      ok: true,
      text: "json 结果",
      error: undefined,
    });

    mode = "sse";
    await expect(client.callTool("send", {})).resolves.toMatchObject({ ok: true, text: "sse 结果" });
  });

  it("HTTP 错误带响应体摘要包装后 reject，并记录 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textRes("server exploded", {}, 500)),
    );

    const client = new McpHttpClient(config());
    const result = await client.callTool("send", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP HTTP 500: server exploded");
    expect(client.error).toContain("MCP HTTP 500");
    expect(client.isConnected).toBe(false);
  });

  it("缺少 url 时 connect 抛错", async () => {
    const client = new McpHttpClient(config({ url: undefined }));
    await expect(client.connect()).rejects.toThrow("远程 server 缺少 url");
  });

  it("shutdown 中止连接并拒绝挂起请求", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const client = new McpHttpClient(config());
    const pending = client.callTool("send", {});
    client.shutdown();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP client 关闭");
    expect(client.isConnected).toBe(false);
  });
});

describe("McpHttpClient legacy SSE", () => {
  it("GET 流等 endpoint 事件，请求 POST 到解析出的上报地址", async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: FetchInit) => {
        calls.push({ url: String(url), init });
        if (!init.method) {
          return sseRes(["event: endpoint\ndata: /message?sid=1\n\n"]);
        }
        const parsed = JSON.parse(String(init.body)) as { id?: number; method?: string };
        if (parsed.method === "notifications/initialized") {
          return textRes("", {}, 202);
        }
        // 个别实现直接在 POST 响应里回 JSON
        return echoId(init.body, { content: [{ type: "text", text: "ok" }] });
      }),
    );

    const client = new McpHttpClient(config({ transport: "sse", url: "http://mcp.test/sse" }));
    await client.connect();
    expect(client.isConnected).toBe(true);

    await expect(client.callTool("send", {})).resolves.toMatchObject({ ok: true, text: "ok" });
    const posted = calls.filter((call) => call.init.method === "POST");
    expect(posted.length).toBeGreaterThanOrEqual(2);
    expect(posted[0]?.url).toBe("http://mcp.test/message?sid=1");
  });

  it("SSE 连接失败与 endpoint 缺失时 POST 报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net down");
      }),
    );
    const client = new McpHttpClient(config({ transport: "sse" }));
    await expect(client.connect()).rejects.toThrow("MCP SSE 连接失败：net down");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textRes("busy", {}, 503)),
    );
    await expect(new McpHttpClient(config({ transport: "sse" })).connect()).rejects.toThrow(
      "MCP SSE 连接失败（HTTP 503）",
    );
  });

  it("POST 上报失败包装为 MCP HTTP 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: FetchInit) => {
        if (!init.method) {
          return sseRes(["event: endpoint\ndata: http://mcp.test/message\n\n"]);
        }
        const parsed = JSON.parse(String(init.body)) as { method?: string };
        if (parsed.method === "initialize") {
          return echoId(init.body, {});
        }
        if (parsed.method === "notifications/initialized") {
          return textRes("", {}, 202);
        }
        return textRes("bad", {}, 400);
      }),
    );

    const client = new McpHttpClient(config({ transport: "sse" }));
    // initialize 的 POST 先走通，工具调用的 POST 才会命中 400 分支
    const connecting = client.connect();
    await connecting;
    const result = await client.callTool("send", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP HTTP 400");
  });
});
