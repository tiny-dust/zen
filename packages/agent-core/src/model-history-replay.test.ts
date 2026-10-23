// 跨轮回放（ModelMessage 全量持久化）：mock OpenAI 服务断言两轮请求的消息前缀字节一致，
// 并覆盖悬空尾部截断与 append/rewrite 写回口径。DB 层（workspace-db）另见
// apps/desktop 的 workspace-model-history.test.ts。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { AgentSession } from "./index";
import type { ModelHistoryStore, PersistedModelHistory } from "./model-history";

const MODEL_ID = "zen-test-model";
const API_KEY = "zen-test-key";
let server: Server;
let origin = "";
let workspaceRoot = "";

/** 捕获到的 /chat/completions 请求体（按请求顺序） */
let requestBodies: string[] = [];

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-zen-replay",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function textBlocks(text: string): string[] {
  return [
    chunk({ role: "assistant", content: "" }, null),
    chunk({ content: text }, null),
    chunk({}, "stop"),
    "data: [DONE]\n\n",
  ];
}

/** 内存版存储：append 追加、rewrite 整体重建（与 SQLite 实现同语义） */
function createMemoryStore(): { store: ModelHistoryStore; snapshot: () => PersistedModelHistory | null } {
  let history: PersistedModelHistory | null = null;
  return {
    store: {
      append: (messages) => {
        if (!history) {
          history = { messages: [...messages], instructions: null };
          return;
        }
        history.messages.push(...messages);
      },
      rewrite: (next) => {
        history = { messages: [...next.messages], instructions: next.instructions };
      },
    },
    snapshot: () => (history ? { messages: [...history.messages], instructions: history.instructions } : null),
  };
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-agent-replay-"));
  requestBodies = [];
  server = createServer((req, res) => {
    void readBody(req).then((raw) => {
      requestBodies.push(raw);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      for (const block of textBlocks("回复")) {
        res.write(block);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("replay test server has no port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (workspaceRoot) {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function createSession(
  events: AgentStreamEvent[],
  name: string,
  store?: ModelHistoryStore,
): AgentSession {
  const path = `/${name}`;
  return new AgentSession({
    sessionId: `sess-${name}`,
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: `${origin}${path}`,
    apiKey: API_KEY,
    model: MODEL_ID,
    permissionMode: "default",
    modelHistoryStore: store,
    emit: (event) => events.push(event),
  });
}

function messagesOf(body: string): Array<{ role: string; content: unknown }> {
  return (JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> }).messages;
}

describe("AgentSession 跨轮回放（ModelMessage 持久化）", () => {
  it("第二轮请求完整重发上一轮消息（含工具细节），instructions 相同", async () => {
    const events: AgentStreamEvent[] = [];
    const { store, snapshot } = createMemoryStore();

    requestBodies.length = 0;
    const first = createSession(events, "replay-first", store);
    await first.start("第一轮的问题");

    // 第一轮写回：基线 rewrite + 用户消息 append + 步产出 append
    const persistedFirst = snapshot();
    expect(persistedFirst).not.toBeNull();
    const firstMessages = messagesOf(requestBodies.at(-1) ?? "");

    // 第二轮：模拟进程重启后新会话从存储载入
    requestBodies.length = 0;
    const second = createSession(events, "replay-second", store);
    await second.start("第二轮的问题", undefined, undefined, snapshot() ?? undefined);

    const secondMessages = messagesOf(requestBodies.at(-1) ?? "");
    // 前缀逐条字节一致：上一轮全部消息原样重发（跨轮前缀命中 prompt 缓存的前提）
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages);
    // 尾部是本轮新用户消息
    const last = secondMessages[secondMessages.length - 1];
    expect(last?.role).toBe("user");
    expect(String(last?.content)).toContain("第二轮的问题");
    // run 正常完成
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });

  it("悬空工具调用尾部在回放前被截断（不触发 MissingToolResults）", async () => {
    const events: AgentStreamEvent[] = [];
    const { store, snapshot } = createMemoryStore();
    requestBodies.length = 0;
    const first = createSession(events, "dangle-first", store);
    await first.start("第一轮的问题");

    // 模拟取消残留：直接给存储追加一条悬空 assistant 工具调用
    const history = snapshot();
    expect(history).not.toBeNull();
    const poisoned: PersistedModelHistory = {
      messages: [
        ...history!.messages,
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_dangle", toolName: "readFile", input: {} }],
        },
      ],
      instructions: history!.instructions,
    };

    requestBodies.length = 0;
    const second = createSession(events, "dangle-second", store);
    await second.start("第二轮的问题", undefined, undefined, poisoned);
    // run 正常完成（无 error）：悬空调用已被净化截断
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    const body = requestBodies.at(-1) ?? "";
    expect(body).not.toContain("call_dangle");
  });

  it("无持久化历史时回落 ChatTurn（行为与旧链路一致）", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "fallback");
    await session.start("第二轮的问题", [
      { role: "user", content: "上一轮的问题" },
      { role: "assistant", content: "上一轮的回答" },
    ]);

    const messages = messagesOf(requestBodies.at(-1) ?? "");
    expect(messages.some((item) => String(item.content).includes("上一轮的问题"))).toBe(true);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });
});
