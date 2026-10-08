import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpStdioClient } from "./stdio";

import type { McpServerConfig } from "@zen/shared";

/**
 * 本地 stdio 传输（mock child_process）：
 * - connect：spawn 命令/参数/env、行分隔 JSON-RPC 写入 stdin
 * - 入站：跨块行缓冲、坏行忽略、结果按 id 分发
 * - stderr 只留诊断缓存；进程退出拒绝挂起请求；shutdown 杀进程
 */

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (enc: string) => void };
  stderr: EventEmitter & { setEncoding: (enc: string) => void };
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "local",
    name: "local-server",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: { FOO: "bar" },
    enabled: true,
    ...overrides,
  };
}

/** 读出客户端写到 stdin 的请求 */
function written(child: FakeChild): Array<{ id?: number; method?: string }> {
  return child.stdin.write.mock.calls.map((call) => JSON.parse(String(call[0])) as never);
}

/** 服务端回包：按行写回 stdout（可切块） */
function reply(child: FakeChild, payload: unknown, chunks = 1): void {
  const line = `${JSON.stringify(payload)}\n`;
  const size = Math.ceil(line.length / chunks);
  for (let i = 0; i < line.length; i += size) {
    child.stdout.emit("data", line.slice(i, i + size));
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("McpStdioClient", () => {
  it("connect 校验 command 并 spawn，initialize 后置 connected", async () => {
    await expect(new McpStdioClient(config({ command: undefined })).connect()).rejects.toThrow(
      "stdio server 缺少 command",
    );

    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());

    const connecting = client.connect();
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["server.js"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );

    // connect 仍在等 initialize 响应
    await Promise.resolve();
    const [init] = written(child);
    expect(init).toMatchObject({ method: "initialize", id: 1 });
    expect(client.isConnected).toBe(false);

    reply(child, { jsonrpc: "2.0", id: init?.id, result: { serverInfo: { name: "fake" } } });
    await connecting;
    expect(client.isConnected).toBe(true);
    // initialized 通知紧随其后
    expect(written(child).some((msg) => msg.method === "notifications/initialized")).toBe(true);
  });

  it("listTools/callTool 走行分隔 JSON-RPC，坏行与跨块行都能处理", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    const tools = client.listTools();
    await Promise.resolve();
    const listReq = written(child).find((msg) => msg.method === "tools/list");
    // 坏行直接忽略
    child.stdout.emit("data", "not-json\n");
    // 跨块行：响应切成 3 段再拼回
    reply(child, {
      jsonrpc: "2.0",
      id: listReq?.id,
      result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] },
    }, 3);
    await expect(tools).resolves.toMatchObject([{ name: "ping", serverId: "local" }]);

    const called = client.callTool("ping", { n: 1 });
    await Promise.resolve();
    const callReq = written(child).find((msg) => msg.method === "tools/call");
    expect(callReq).toMatchObject({ params: { name: "ping", arguments: { n: 1 } } });
    reply(child, {
      jsonrpc: "2.0",
      id: callReq?.id,
      result: { content: [{ type: "text", text: "pong" }] },
    });
    await expect(called).resolves.toEqual({ ok: true, text: "pong", error: undefined });
  });

  it("stderr 只缓存诊断；进程退出拒绝挂起请求并断开", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    child.stderr.emit("data", "  warn: something  ");
    expect(client.error).toBe("warn: something");

    const pending = client.callTool("ping", {});
    await Promise.resolve();
    child.emit("exit", 0);
    expect(client.isConnected).toBe(false);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP server 进程退出");
  });

  it("进程 error 记录错误；shutdown 杀进程，未运行时 sendRaw 抛错", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    child.emit("error", new Error("spawn failed"));
    expect(client.error).toBe("spawn failed");

    client.shutdown();
    expect(child.kill).toHaveBeenCalled();
    expect(client.isConnected).toBe(false);

    await expect(client.callTool("ping", {})).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("未运行"),
    });
  });

  it("重复 connect 不会二次 spawn", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;
    await client.connect();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
