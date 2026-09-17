import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent, ProviderProtocol } from "@zen/shared";

import { AgentSession } from "./index";

/**
 * 协议冒烟测试。
 *
 * 起一个本地 node:http 假服务器，用三种协议各自的**真实 SSE 线格式**流式返回一段文本，
 * 然后同时断言两侧：
 *  - 服务端侧：method / path / 鉴权头 / JSON body（model + 用户消息）；
 *  - 客户端侧：`delta` 文本拼起来等于流式文本，且以 done:stop 收尾、没有 error 事件。
 */

const MODEL_ID = "zen-test-model";
const API_KEY = "zen-test-key";
const USER_MESSAGE = "ping from the protocol test";
const REPLY_CHUNKS = ["hi", " there"] as const;
const REPLY_TEXT = REPLY_CHUNKS.join("");

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const MESSAGES_PATH = "/v1/messages";

interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  rawBody: string;
  json: Record<string, unknown>;
}

type DeltaEvent = Extract<AgentStreamEvent, { type: "delta" }>;
type DoneEvent = Extract<AgentStreamEvent, { type: "done" }>;

const requests: RecordedRequest[] = [];
let server: Server;
let origin = "";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** OpenAI Chat Completions：`data: {...}` 增量块，最后 `data: [DONE]`。 */
function chatCompletionsSse(): string[] {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null): string =>
    `data: ${JSON.stringify({
      id: "chatcmpl-zen-test",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL_ID,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;

  return [
    chunk({ role: "assistant", content: "" }, null),
    ...REPLY_CHUNKS.map((text) => chunk({ content: text }, null)),
    chunk({}, "stop"),
    "data: [DONE]\n\n",
  ];
}

/** OpenAI Responses：`response.created` → `response.output_text.delta` → … → `response.completed`。 */
function responsesSse(): string[] {
  const event = (type: string, payload: Record<string, unknown>): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

  return [
    event("response.created", {
      response: { id: "resp_zen_test", created_at: 0, model: MODEL_ID, status: "in_progress" },
    }),
    event("response.output_item.added", {
      output_index: 0,
      item: { type: "message", id: "msg_zen_test", status: "in_progress", role: "assistant", content: [] },
    }),
    ...REPLY_CHUNKS.map((delta) =>
      event("response.output_text.delta", { item_id: "msg_zen_test", output_index: 0, delta }),
    ),
    event("response.output_text.done", {
      item_id: "msg_zen_test",
      output_index: 0,
      text: REPLY_TEXT,
    }),
    event("response.output_item.done", {
      output_index: 0,
      item: { type: "message", id: "msg_zen_test", status: "completed", role: "assistant" },
    }),
    event("response.completed", {
      response: {
        id: "resp_zen_test",
        created_at: 0,
        model: MODEL_ID,
        status: "completed",
        output: [],
        usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
      },
    }),
  ];
}

/** Anthropic Messages：`message_start` → `content_block_delta(text_delta)` → `message_stop`。 */
function anthropicSse(): string[] {
  const event = (type: string, payload: Record<string, unknown>): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

  return [
    event("message_start", {
      message: {
        id: "msg_zen_test",
        type: "message",
        role: "assistant",
        model: MODEL_ID,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 1 },
      },
    }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...REPLY_CHUNKS.map((text) =>
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    ),
    event("content_block_stop", { index: 0 }),
    event("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 3 },
    }),
    event("message_stop", {}),
  ];
}

function sseBlocks(path: string): string[] | null {
  if (path === CHAT_COMPLETIONS_PATH) {
    return chatCompletionsSse();
  }
  if (path === RESPONSES_PATH) {
    return responsesSse();
  }
  if (path === MESSAGES_PATH) {
    return anthropicSse();
  }
  return null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  requests.push({
    method: req.method ?? "",
    path,
    headers: req.headers,
    rawBody,
    json: parseJsonObject(rawBody),
  });

  const blocks = sseBlocks(path);
  if (!blocks) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `unexpected path: ${path}` } }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const block of blocks) {
    res.write(block);
    await delay(2);
  }
  res.end();
}

interface RunResult {
  events: AgentStreamEvent[];
  request: RecordedRequest;
}

async function runSession(protocol: ProviderProtocol, baseUrl: string): Promise<RunResult> {
  const firstRequestIndex = requests.length;
  const events: AgentStreamEvent[] = [];
  const session = new AgentSession({
    sessionId: `session-${protocol}`,
    workspaceRoot: process.cwd(),
    protocol,
    baseUrl,
    apiKey: API_KEY,
    model: MODEL_ID,
    permissionMode: "smart",
    emit: (event) => events.push(event),
  });

  await session.start(USER_MESSAGE);

  const request = requests[firstRequestIndex];
  if (!request) {
    throw new Error(`${protocol}: 假服务器没有收到请求`);
  }
  return { events, request };
}

function deltaText(events: AgentStreamEvent[]): string {
  return events
    .filter((event): event is DeltaEvent => event.type === "delta")
    .map((event) => event.text)
    .join("");
}

function errorMessages(events: AgentStreamEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: "error" }> => event.type === "error")
    .map((event) => event.message);
}

function doneEvents(events: AgentStreamEvent[]): DoneEvent[] {
  return events.filter((event): event is DoneEvent => event.type === "done");
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("假服务器没有拿到端口");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("provider 协议", () => {
  it("openai-chat 走 /v1/chat/completions 与 Bearer 鉴权", async () => {
    const { events, request } = await runSession("openai-chat", `${origin}/v1`);

    expect(request.method).toBe("POST");
    expect(request.path).toBe(CHAT_COMPLETIONS_PATH);
    expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.json.model).toBe(MODEL_ID);
    expect(Array.isArray(request.json.messages)).toBe(true);
    expect(request.rawBody).toContain(USER_MESSAGE);

    expect(deltaText(events)).toBe(REPLY_TEXT);
    expect(errorMessages(events)).toEqual([]);
    const done = doneEvents(events);
    expect(done.map((event) => event.reason)).toEqual(["stop"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("openai-responses 走 /v1/responses 与 Bearer 鉴权", async () => {
    const { events, request } = await runSession("openai-responses", `${origin}/v1`);

    expect(request.method).toBe("POST");
    expect(request.path).toBe(RESPONSES_PATH);
    expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.json.model).toBe(MODEL_ID);
    expect(Array.isArray(request.json.input)).toBe(true);
    expect(request.rawBody).toContain(USER_MESSAGE);

    expect(deltaText(events)).toBe(REPLY_TEXT);
    expect(errorMessages(events)).toEqual([]);
    const done = doneEvents(events);
    expect(done.map((event) => event.reason)).toEqual(["stop"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("anthropic-messages 走 /v1/messages 与 x-api-key 鉴权", async () => {
    const { events, request } = await runSession("anthropic-messages", `${origin}/v1`);

    expect(request.method).toBe("POST");
    expect(request.path).toBe(MESSAGES_PATH);
    expect(request.headers["x-api-key"]).toBe(API_KEY);
    expect(typeof request.headers["anthropic-version"]).toBe("string");
    expect(request.headers["anthropic-version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(request.headers.authorization).toBeUndefined();
    expect(request.json.model).toBe(MODEL_ID);
    expect(Array.isArray(request.json.messages)).toBe(true);
    expect(request.rawBody).toContain(USER_MESSAGE);

    expect(deltaText(events)).toBe(REPLY_TEXT);
    expect(errorMessages(events)).toEqual([]);
    const done = doneEvents(events);
    expect(done.map((event) => event.reason)).toEqual(["stop"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("baseUrl 不带版本段时补 /v1（不重复拼接）", async () => {
    const { events, request } = await runSession("openai-chat", origin);

    expect(request.path).toBe(CHAT_COMPLETIONS_PATH);
    expect(deltaText(events)).toBe(REPLY_TEXT);
    expect(errorMessages(events)).toEqual([]);
    expect(doneEvents(events).map((event) => event.reason)).toEqual(["stop"]);
  });
});
