import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { AgentSession } from "./index";

/**
 * history 含 system 轮（上下文压缩摘要）的回归：
 * AI SDK v7 禁止 messages 携带 system（Invalid prompt: System messages are
 * not allowed ...）。start() 必须把 system 轮并入 instructions，run 正常完成。
 */

const MODEL_ID = "zen-test-model";
const API_KEY = "zen-test-key";
let server: Server;
let origin = "";
let workspaceRoot = "";

/** 捕获到的 /chat/completions 请求体（最后一个） */
let lastBody: { messages?: Array<{ role: string; content?: string }> } | null = null;

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-zen-history",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-agent-history-"));
  server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      try {
        lastBody = JSON.parse(raw) as typeof lastBody;
      } catch {
        lastBody = null;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      for (const block of [
        chunk({ role: "assistant", content: "" }, null),
        chunk({ content: "hello" }, null),
        chunk({}, "stop"),
        "data: [DONE]\n\n",
      ]) {
        res.write(block);
      }
      res.end();
    })().catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("history test server has no port");
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

function createSession(events: AgentStreamEvent[]): AgentSession {
  return new AgentSession({
    sessionId: "history-regression",
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: origin,
    apiKey: API_KEY,
    model: MODEL_ID,
    permissionMode: "default",
    emit: (event) => events.push(event),
  });
}

describe("AgentSession history system 轮", () => {
  it("history 的 system 轮并入 instructions，run 正常完成不发 error", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events);
    const summary = "【会话摘要 · 上下文已压缩】更早对话的整理摘要 ZEN-SUMMARY-MARKER";
    await session.start(
      "继续推进",
      [
        { role: "user", content: "第一个问题" },
        { role: "assistant", content: "第一个回答" },
        // 压缩摘要由 UI 以 system 轮下发（chat-types compressHistory）
        { role: "system", content: summary },
      ],
    );

    const errors = events.filter((event) => event.type === "error");
    expect(errors).toEqual([]);
    expect(events.at(-1)?.type).toBe("done");

    // 模型请求里：instructions 走首条 system 消息（含摘要），messages 无第二条 system
    expect(lastBody).not.toBeNull();
    const messages = lastBody?.messages ?? [];
    const systemMessages = messages.filter((message) => message.role === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.content ?? "").toContain("ZEN-SUMMARY-MARKER");
    expect(messages.some((message) => message.role === "user")).toBe(true);
    // 摘要不得以 user 轮混入消息列表
    expect(
      messages.some(
        (message) => message.role === "user" && (message.content ?? "").includes("ZEN-SUMMARY-MARKER"),
      ),
    ).toBe(false);
  }, 15_000);
});
