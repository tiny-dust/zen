import { describe, expect, it, vi } from "vitest";

import { consumeSseStream, McpBaseClient } from "./base";

import type { McpServerConfig } from "@zen/shared";
import type { JsonRpcMessage } from "./base";

/**
 * JSON-RPC 底座与 SSE 分帧：
 * - request：id 分配、结果/错误分发、超时、sendRaw 抛错、rejectAllPending
 * - listTools / callTool 的结果映射与错误包装
 * - consumeSseStream：跨块分帧、多行 data、CRLF、注释心跳、跨块多字节字符
 */

class TestClient extends McpBaseClient {
  sent: string[] = [];
  connectedFlag = true;
  lastError: string | null = null;

  get isConnected(): boolean {
    return this.connectedFlag;
  }

  get error(): string | null {
    return this.lastError;
  }

  async connect(): Promise<void> {
    this.connectedFlag = true;
  }

  shutdown(): void {
    this.rejectAllPending("MCP client 关闭");
    this.connectedFlag = false;
  }

  protected sendRaw(payload: string): void {
    this.sent.push(payload);
  }

  /** 测试注入：把服务端响应喂回底座 */
  feed(message: JsonRpcMessage): void {
    this.handleResponse(message);
  }

  requestRaw(method: string, params: unknown): Promise<unknown> {
    return this.request(method, params);
  }

  notifyRaw(method: string, params: unknown): void {
    this.notify(method, params);
  }

  rejectAll(reason: string): void {
    this.rejectAllPending(reason);
  }
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "test-server",
    transport: "stdio",
    command: "echo",
    enabled: true,
    ...overrides,
  };
}

describe("McpBaseClient 请求/响应", () => {
  it("request 自增 id 并按 id 分发结果", async () => {
    const client = new TestClient(config());
    const first = client.requestRaw("tools/list", {});
    const second = client.requestRaw("tools/call", { name: "t" });

    expect(client.sent).toHaveLength(2);
    expect(JSON.parse(client.sent[0]!)).toMatchObject({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(JSON.parse(client.sent[1]!)).toMatchObject({ id: 2, method: "tools/call" });

    client.feed({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    client.feed({ jsonrpc: "2.0", id: 1, result: { ok: false } });
    await expect(second).resolves.toEqual({ ok: true });
    await expect(first).resolves.toEqual({ ok: false });
  });

  it("错误响应按 method 包装后 reject；未知 id 与通知忽略", async () => {
    const client = new TestClient(config());
    const pending = client.requestRaw("tools/list", {});
    client.feed({ jsonrpc: "2.0", id: 99, result: {} });
    client.feed({ jsonrpc: "2.0", method: "notifications/message", params: {} });
    client.feed({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "method not found" },
    });

    await expect(pending).rejects.toThrow("MCP tools/list: method not found");
  });

  it("sendRaw 抛错时清掉 pending 并 reject", async () => {
    class BrokenClient extends TestClient {
      protected override sendRaw(): void {
        throw new Error("pipe broken");
      }
    }
    const client = new BrokenClient(config());
    await expect(client.requestRaw("tools/list", {})).rejects.toThrow("pipe broken");
    // pending 已清理：再次 feed 不产生副作用
    client.feed({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("rejectAllPending 用原因拒绝所有挂起请求", async () => {
    const client = new TestClient(config());
    const a = client.requestRaw("tools/list", {});
    const b = client.requestRaw("tools/call", {});
    client.rejectAll("MCP client 关闭");
    await expect(a).rejects.toThrow("MCP tools/list: MCP client 关闭");
    await expect(b).rejects.toThrow("MCP tools/call: MCP client 关闭");
  });

  it("notify 发送无 id 通知", () => {
    const client = new TestClient(config());
    client.notifyRaw("notifications/initialized", {});
    expect(JSON.parse(client.sent[0]!)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
  });

  it("请求超时（30s）后 reject", async () => {
    vi.useFakeTimers();
    try {
      const client = new TestClient(config());
      const pending = client.requestRaw("tools/list", {});
      const assertion = expect(pending).rejects.toThrow("MCP tools/list 超时（30s）");
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("McpBaseClient listTools / callTool", () => {
  it("listTools 映射 name/description/inputSchema，缺省兜底", async () => {
    const client = new TestClient(config());
    const pending = client.listTools();
    client.feed({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "send", description: "发消息", inputSchema: { type: "object" } },
          { description: "无名工具" },
        ],
      },
    });

    await expect(pending).resolves.toEqual([
      {
        serverId: "srv-1",
        name: "send",
        description: "发消息",
        inputSchema: { type: "object" },
      },
      {
        serverId: "srv-1",
        name: "",
        description: "无名工具",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });

  it("listTools 空清单返回 []", async () => {
    const client = new TestClient(config());
    const pending = client.listTools();
    client.feed({ jsonrpc: "2.0", id: 1, result: {} });
    await expect(pending).resolves.toEqual([]);
  });

  it("callTool 拼接 text block，isError 时 ok=false 且 error=文本", async () => {
    const client = new TestClient(config());
    const okPending = client.callTool("send", { to: "x" });
    expect(JSON.parse(client.sent[0]!)).toMatchObject({
      method: "tools/call",
      params: { name: "send", arguments: { to: "x" } },
    });
    client.feed({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          { type: "text", text: "第一段" },
          { type: "image", data: "xxx" },
          { type: "text", text: "第二段" },
        ],
      },
    });
    await expect(okPending).resolves.toEqual({ ok: true, text: "第一段\n第二段", error: undefined });

    const errPending = client.callTool("send", undefined);
    client.feed({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "失败详情" }], isError: true },
    });
    await expect(errPending).resolves.toEqual({ ok: false, text: "失败详情", error: "失败详情" });
  });

  it("callTool 把请求异常包装为 ok=false", async () => {
    const client = new TestClient(config());
    const pending = client.callTool("send", {});
    client.feed({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -1, message: "server exploded" },
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      text: "",
      error: "MCP tools/call: server exploded",
    });
  });
});

function streamOf(chunks: Array<Uint8Array | string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : (chunk as Uint8Array));
    },
  });
}

describe("consumeSseStream", () => {
  it("解析 event/data，多行 data 用换行拼接，注释与空 data 忽略", async () => {
    const received: Array<[string, string]> = [];
    await consumeSseStream(
      streamOf([
        ": heartbeat\n\n",
        "event: endpoint\ndata: /post\n\n",
        "event: message\ndata: {\"a\":1}\ndata: {\"b\":2}\n\n",
        "event: empty\n\n",
      ]),
      (event, data) => received.push([event, data]),
    );

    expect(received).toEqual([
      ["endpoint", "/post"],
      ["message", '{"a":1}\n{"b":2}'],
    ]);
  });

  it("兼容 CRLF 分隔与无 event 字段（默认 message）", async () => {
    const received: Array<[string, string]> = [];
    await consumeSseStream(
      streamOf(["data: hello\r\n\r\n", "data: world\r\n\r\n"]),
      (event, data) => received.push([event, data]),
    );
    expect(received).toEqual([
      ["message", "hello"],
      ["message", "world"],
    ]);
  });

  it("事件跨块到达时缓存到完整帧再派发", async () => {
    const received: Array<[string, string]> = [];
    await consumeSseStream(
      streamOf(["event: par", "tial\ndata: 12", "34\n", "\n", "data: tail\n\n"]),
      (event, data) => received.push([event, data]),
    );
    expect(received).toEqual([
      ["partial", "1234"],
      ["message", "tail"],
    ]);
  });

  it("跨块多字节字符不被切坏", async () => {
    const bytes = new TextEncoder().encode("data: 中文测试\n\n");
    const received: Array<[string, string]> = [];
    await consumeSseStream(
      streamOf([bytes.slice(0, 8), bytes.slice(8, 11), bytes.slice(11)]),
      (event, data) => received.push([event, data]),
    );
    expect(received).toEqual([["message", "中文测试"]]);
  });

  it("底层流抛错时 reject", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream broke");
      },
    });
    await expect(consumeSseStream(failing, () => {})).rejects.toThrow("stream broke");
  });
});
