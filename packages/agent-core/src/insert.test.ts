import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { AgentSession, insertUserContent } from "./index";

/**
 * 插入执行状态链路（事件序回归）：
 * - insert：暂停原 run → insert_started → 插入 run 事件流 → done(phase=insert) →
 *   original_resumed → 原 run 续跑 → 最终 done(stop)
 * - 并发插入 / 等审批时插入被拒绝
 * - 插入 run 中取消：插入 run 与原 run 一并终止，无悬挂
 */

const MODEL_ID = "zen-test-model";
const API_KEY = "zen-test-key";
let server: Server;
let origin = "";
let workspaceRoot = "";

type RouteKind = "ok" | "write-tool" | "slow";

const routes = new Map<string, RouteKind>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-zen-insert",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function blocksFor(kind: RouteKind): string[] {
  if (kind === "write-tool") {
    return [
      chunk({ role: "assistant", content: "" }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: "call_write_insert",
              type: "function",
              function: {
                name: "writeFile",
                arguments: JSON.stringify({ path: "zen-insert-tmp.txt", content: "hello" }),
              },
            },
          ],
        },
        null,
      ),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ];
  }
  if (kind === "slow") {
    return Array.from({ length: 40 }, (_, i) => chunk({ content: `tick-${i} ` }, null)).concat([
      chunk({}, "stop"),
      "data: [DONE]\n\n",
    ]);
  }
  return [
    chunk({ role: "assistant", content: "" }, null),
    chunk({ content: "hello" }, null),
    chunk({}, "stop"),
    "data: [DONE]\n\n",
  ];
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await readBody(req);
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const kind = routes.get(path) ?? "ok";
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const blocks = blocksFor(kind);
  const stepMs = kind === "slow" ? 30 : 2;
  for (const block of blocks) {
    if (res.destroyed) {
      return;
    }
    res.write(block);
    await delay(stepMs);
  }
  res.end();
}

function createSession(events: AgentStreamEvent[], name: string, kind: RouteKind): AgentSession {
  const path = `/${name}`;
  routes.set(`${path}/v1/chat/completions`, kind);
  return new AgentSession({
    sessionId: `insert-${name}`,
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: `${origin}${path}`,
    apiKey: API_KEY,
    model: MODEL_ID,
    permissionMode: "default",
    emit: (event) => events.push(event),
  });
}

/** 轮询等待某事件出现（异步流式落点），超时抛错 */
async function waitFor(
  events: AgentStreamEvent[],
  pred: (event: AgentStreamEvent) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some(pred)) {
      return;
    }
    await delay(20);
  }
  throw new Error(
    `waitFor timeout: events=${JSON.stringify(events.map((e) => e.type))}`,
  );
}

function doneEvents(events: AgentStreamEvent[]) {
  return events.filter(
    (e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done",
  );
}

function indexOfEvent(events: AgentStreamEvent[], pred: (e: AgentStreamEvent) => boolean): number {
  return events.findIndex(pred);
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-agent-insert-"));
  server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("insert test server has no port");
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

describe("AgentSession.insert 状态链路", () => {
  it("插入消息包装保留原始文本并带最高优先级指令", () => {
    const content = insertUserContent("帮我看下日志");
    expect(content).toContain("最高优先级");
    expect(content).toContain("原任务");
    expect(content.endsWith("帮我看下日志")).toBe(true);
  });

  it(
    "insert：暂停原 run → 插入 run 先执行完 → 原 run 自动恢复并跑完",
    async () => {
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, "insert-ok", "slow");
      const started = session.start("long running task");
      await delay(100);

      const insertResult = session.insert("插入的指令");
      await waitFor(events, (e) => e.type === "insert_started");
      // 暂停落点：原 run 被打断时先短暂进入 paused，再由 insert_started 切走
      expect(events.some((e) => e.type === "status" && e.status === "paused")).toBe(true);

      await insertResult;
      await started;

      const insertStarted = indexOfEvent(events, (e) => e.type === "insert_started");
      const insertDone = indexOfEvent(
        events,
        (e) => e.type === "done" && e.phase === "insert",
      );
      const resumed = indexOfEvent(events, (e) => e.type === "original_resumed");
      expect(insertStarted).toBeGreaterThan(-1);
      expect(insertDone).toBeGreaterThan(insertStarted);
      expect(resumed).toBeGreaterThan(insertDone);

      const dones = doneEvents(events);
      // 恰好一个 insert 阶段 done + 一个最终 done(stop)
      expect(dones.filter((e) => e.phase === "insert")).toHaveLength(1);
      expect(dones.filter((e) => !e.phase)).toEqual([
        { type: "done", sessionId: session.sessionId, reason: "stop" },
      ]);
      // 最终 done 在 original_resumed 之后：插入 run 的 done 不终结整个会话
      let finalDone = -1;
      events.forEach((event, index) => {
        if (event.type === "done" && !event.phase) {
          finalDone = index;
        }
      });
      expect(finalDone).toBeGreaterThan(resumed);
      // 恢复后原 run 继续产生输出（第二次流式轮）
      const deltasAfterResume = events.slice(resumed).filter((e) => e.type === "delta");
      expect(deltasAfterResume.length).toBeGreaterThan(0);
    },
    20_000,
  );

  it(
    "插入 run 进行中再次插入被拒绝，首次插入不受影响",
    async () => {
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, "insert-concurrent", "slow");
      const started = session.start("long running task");
      await delay(100);

      const first = session.insert("第一次插入");
      await waitFor(events, (e) => e.type === "insert_started");

      const second = await session.insert("第二次插入");
      expect(second.ok).toBe(false);
      expect(second.error).toContain("插入");

      await first;
      await started;
      // 首次插入照常走完整个状态链
      expect(events.some((e) => e.type === "done" && e.phase === "insert")).toBe(true);
      expect(events.some((e) => e.type === "original_resumed")).toBe(true);
    },
    20_000,
  );

  it(
    "等待工具审批时插入被拒绝，不产生 insert_started",
    async () => {
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, "insert-approval", "write-tool");
      const started = session.start("need write approval");
      await delay(150);
      const request = events.find((e) => e.type === "approval_request");
      if (request?.type !== "approval_request") {
        throw new Error(`missing approval_request, events=${JSON.stringify(events.map((e) => e.type))}`);
      }

      const guard = await session.insert("试试插入");
      expect(guard.ok).toBe(false);
      expect(guard.error).toContain("审批");
      expect(events.some((e) => e.type === "insert_started")).toBe(false);

      // 清理：批准让原 run 正常结束
      await session.approve({ approvalId: request.request.approvalId, approved: true });
      await started;
    },
    15_000,
  );

  it(
    "插入 run 执行中取消：插入 run 与原 run 一并终止，不再恢复",
    async () => {
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, "insert-cancel", "slow");
      const started = session.start("long running task");
      await delay(100);

      const inserting = session.insert("会被取消的插入");
      await waitFor(events, (e) => e.type === "insert_started");

      await session.cancel();
      await Promise.all([started, inserting]);

      const dones = doneEvents(events);
      // 只有一个真实终态 done(cancelled)，没有 insert 阶段 done、没有恢复
      expect(dones.filter((e) => e.phase === "insert")).toHaveLength(0);
      expect(dones).toEqual([{ type: "done", sessionId: session.sessionId, reason: "cancelled" }]);
      expect(events.some((e) => e.type === "original_resumed")).toBe(false);
      expect(events.at(-1)?.type).toBe("done");
    },
    15_000,
  );
});
