import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentStreamEvent, WorkspaceGroup } from "@zen/shared";
import { RemoteBridge, type RemoteDeps } from "./bridge";

const session = {
  id: "s1", title: "聊天", workspaceId: "common", archived: false,
  draft: "private draft", pinned: false, createdAt: 1, updatedAt: 2,
};
const group: WorkspaceGroup = {
  id: "common", name: "公共区", path: null, kind: "common",
  pinned: false, archived: false, createdAt: 1, sessions: [session],
};

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  message(value: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

describe("RemoteBridge", () => {
  let dir: string;
  let bridge: RemoteBridge;
  let sockets: FakeSocket[];
  let connect: ReturnType<typeof vi.fn<(url: string) => WebSocket>>;
  let busy: boolean;
  let groups: WorkspaceGroup[];
  let lookup: RemoteDeps["getSession"];
  let sendEvent: (event: AgentStreamEvent) => void;
  let finish: () => void;
  const continueChat = vi.fn((_id: string, _text: string, send: (event: AgentStreamEvent) => void, onFinished: () => void) => {
    sendEvent = send;
    finish = onFinished;
    return { ok: true, sessionId: "s1" };
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zen-remote-test-"));
    sockets = [];
    busy = false;
    groups = [group];
    lookup = (id) => id === "s1" ? {
      session, messages: [{ id: "m1", role: "assistant", content: "hello", createdAt: 2,
        meta: { token: "NEVER_SEND" }, reasoning: "NEVER_SEND" }], taskLists: [],
    } : undefined;
    continueChat.mockClear();
    connect = vi.fn((_url: string): WebSocket => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    bridge = new RemoteBridge({
      file: join(dir, "remote-device.json"), broadcast: vi.fn(),
      connect, listGroups: () => groups,
      getSession: (id) => lookup(id),
      isBusy: () => busy, continueChat,
    });
  });
  afterEach(async () => {
    bridge.shutdown();
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function ready() {
    await bridge.start();
    await bridge.setConfig({ enabled: true, relayUrl: "wss://example.test" });
    const socket = sockets.at(-1)!;
    socket.open();
    socket.message({ type: "ready" });
    return socket;
  }

  it("默认离线，密钥只落本地 0600 文件，禁用时不建连接", async () => {
    const config = await bridge.start();
    expect(config).toMatchObject({ enabled: false, relayUrl: "", status: "disabled" });
    expect(JSON.stringify(config)).not.toContain("secret");
    expect(connect).not.toHaveBeenCalled();
    const saved = JSON.parse(await readFile(join(dir, "remote-device.json"), "utf8"));
    expect(saved.secret).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect((await stat(join(dir, "remote-device.json"))).mode & 0o777).toBe(0o600);
    await expect(bridge.setConfig({ enabled: true, relayUrl: "ws://example.test" })).rejects.toThrow("wss://");
    await expect(bridge.setConfig({ relayUrl: "wss://user:pass@example.test" })).rejects.toThrow("wss://");
  });

  it("ready 前拒绝 RPC，hello 带设备凭据，之后接受配对码", async () => {
    await bridge.start();
    await bridge.setConfig({ enabled: true, relayUrl: "wss://example.test" });
    expect(connect).toHaveBeenCalledWith("wss://example.test/ws/device");
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent[0]).toMatchObject({ type: "hello", deviceId: bridge.getConfig().deviceId });
    expect(socket.sent[0]?.secret).toMatch(/^[0-9a-f]{64}$/);
    socket.message({ type: "request", id: "early", action: "sessions.list" });
    expect(socket.sent).toHaveLength(1);
    await expect(bridge.requestPairCode()).rejects.toThrow();
    socket.message({ type: "ready" });
    const pending = bridge.requestPairCode();
    expect(socket.sent.at(-1)).toEqual({ type: "pair.request" });
    socket.message({ type: "pair.code", code: "123456", expiresAt: 1234 });
    await expect(pending).resolves.toEqual({ code: "123456", expiresAt: 1234 });
  });

  it("只处理明确的会话 RPC，快照去敏感字段且限制消息长度", async () => {
    const socket = await ready();
    socket.message({ type: "request", id: "list", action: "sessions.list" });
    expect(socket.sent.at(-1)).toMatchObject({ type: "response", id: "list", ok: true });
    expect(JSON.stringify(socket.sent.at(-1))).not.toContain("private draft");
    socket.message({ type: "request", id: "get", action: "sessions.get", sessionId: "s1" });
    const snapshot = socket.sent.at(-1);
    expect(snapshot).toMatchObject({ id: "get", ok: true, data: { messages: [{ content: "hello" }] } });
    expect(JSON.stringify(snapshot)).not.toContain("NEVER_SEND");
    socket.message({ type: "request", id: "bad", action: "agent.approve", sessionId: "s1" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "bad", ok: false });
    socket.message({ type: "request", id: "missing", action: "sessions.get", sessionId: "unknown" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "missing", ok: false });
    socket.message({ type: "request", id: "oversize", action: "message.send", sessionId: "s1", text: "a".repeat(8_001) });
    expect(socket.sent.at(-1)).toMatchObject({ id: "oversize", ok: false });
    expect(continueChat).not.toHaveBeenCalled();
  });

  it("忙态/连续发送拒绝并发，只转发白名单事件", async () => {
    const socket = await ready();
    busy = true;
    socket.message({ type: "request", id: "busy", action: "message.send", sessionId: "s1", text: "hello" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "busy", ok: false, error: "session busy" });
    busy = false;
    socket.message({ type: "request", id: "first", action: "message.send", sessionId: "s1", text: "hello" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "first", ok: true });
    socket.message({ type: "request", id: "second", action: "message.send", sessionId: "s1", text: "hello" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "second", ok: false, error: "session busy" });
    sendEvent({ type: "tool_progress", sessionId: "s1", event: { toolName: "runTerminal", outputTail: "SECRET" } } as AgentStreamEvent);
    sendEvent({ type: "delta", sessionId: "s1", text: "a".repeat(3_000) });
    sendEvent({ type: "status", sessionId: "s1", status: "answering" });
    sendEvent({ type: "done", sessionId: "s1", reason: "stop" });
    expect(JSON.stringify(socket.sent)).not.toContain("SECRET");
    const events = socket.sent.filter((frame) => frame.type === "event");
    expect(events.filter((frame) => (frame.event as { type: string }).type === "delta")
      .map((frame) => (frame.event as { text: string }).text).join("")).toBe("a".repeat(3_000));
    sendEvent({ type: "delta", sessionId: "s1", text: `${"a".repeat(2_047)}😀尾` });
    const unicodeParts = socket.sent.filter((frame) => frame.type === "event" && (frame.event as { type: string }).type === "delta")
      .slice(-2).map((frame) => (frame.event as { text: string }).text);
    expect(unicodeParts.join("")).toBe(`${"a".repeat(2_047)}😀尾`);
    expect(events.at(-2)).toMatchObject({ event: { type: "status", status: "answering" } });
    expect(events.at(-1)).toMatchObject({ event: { type: "done" } });
    finish();
    socket.message({ type: "request", id: "third", action: "message.send", sessionId: "s1", text: "again" });
    expect(socket.sent.at(-1)).toMatchObject({ id: "third", ok: true });
  });

  it("配对频率限制立即失败，不等待超时也不断开设备", async () => {
    const socket = await ready();
    const pending = bridge.requestPairCode();
    socket.message({ type: "error", error: "pairing rate limited" });
    await expect(pending).rejects.toThrow("频繁");
    expect(bridge.getConfig().status).toBe("connected");
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("响应保留最近消息且不超过 relay 的单帧限制", async () => {
    const socket = await ready();
    lookup = () => ({ session, taskLists: [], messages: Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`, role: "assistant" as const, content: "聊".repeat(8_000), createdAt: i,
    })) });
    groups = [{ ...group, sessions: Array.from({ length: 100 }, (_, i) => ({ ...session, id: `s${i}`, title: "聊".repeat(200) })) }];
    socket.message({ type: "request", id: "list", action: "sessions.list" });
    const list = socket.sent.at(-1)!;
    expect(list.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(32_768);
    socket.message({ type: "request", id: "get", action: "sessions.get", sessionId: "s1" });
    const detail = socket.sent.at(-1)!;
    expect(detail.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThan(32_768);
    expect((detail.data as { messages: Array<{ id: string }> }).messages.at(-1)?.id).toBe("m99");
  });

  it("断线重连并在撤销后停止、轮换 secret", async () => {
    vi.useFakeTimers();
    const socket = await ready();
    const oldSecret = socket.sent[0]?.secret;
    socket.close();
    expect(bridge.getConfig().status).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]?.secret).toBe(oldSecret);
    await expect(bridge.revoke()).rejects.toThrow("中继未连接");
    sockets[1]!.message({ type: "ready" });
    const revoking = bridge.revoke();
    const rotation = sockets[1]!.sent.at(-1)!;
    expect(rotation).toMatchObject({ type: "device.rotate" });
    expect(rotation.secret).not.toBe(oldSecret);
    sockets[1]!.message({ type: "device.rotated" });
    const revoked = await revoking;
    expect(revoked).toMatchObject({ enabled: false, status: "disabled" });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sockets).toHaveLength(2);
    const rotated = JSON.parse(await readFile(join(dir, "remote-device.json"), "utf8")).secret;
    expect(rotated).not.toBe(oldSecret);
    await bridge.setConfig({ enabled: true });
    expect(sockets).toHaveLength(3);
    sockets[2]!.open();
    expect(sockets[2]!.sent[0]?.secret).toBe(rotated);
    sockets[2]!.message({ type: "ready" });
    expect(bridge.getConfig().status).toBe("connected");
  });
});
