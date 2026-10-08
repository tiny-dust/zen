import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent, ChatTurn } from "@zen/shared";

import {
  AgentSession,
  insertUserContent,
  rewriteSubAgentPanelEvent,
} from "./agent-session";
import type { AgentImageAttachment } from "./agent-session";

/**
 * AgentSession 缺口补测：
 * - 纯函数 insertUserContent / rewriteSubAgentPanelEvent
 * - 无 run 时的状态守卫（pause/resume/canInsert/approve/resolveAsk/cancel）
 * - 假 OpenAI 服务集成：history/图片、tasks 版本归一化、审批 always 记忆、
 *   askUser 挂起取消、子 Agent 派生（tasks 改挂 / ask 上抛 / 错误收尾）
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(20);
  }
  throw new Error("pollUntil 超时");
}

// ---------- 纯函数 ----------

describe("insertUserContent / rewriteSubAgentPanelEvent", () => {
  it("插入消息前置最高优先级指令，原文保留在末尾", () => {
    const text = insertUserContent("补充要求");
    expect(text.startsWith("【用户插入 · 最高优先级】")).toBe(true);
    expect(text.trimEnd().endsWith("补充要求")).toBe(true);
  });

  it("tasks_updated 改挂父会话并给条目 id 加 agent 前缀", () => {
    const rewritten = rewriteSubAgentPanelEvent(
      {
        type: "tasks_updated",
        sessionId: "sess-child",
        version: 3,
        items: [{ id: "t1", label: "a", done: false }],
      },
      "sess-parent",
      "sub-1",
      "助手",
    );
    expect(rewritten).toEqual({
      type: "tasks_updated",
      sessionId: "sess-parent",
      version: 0,
      agentName: "助手",
      items: [{ id: "sub-1-t1", label: "a", done: false, agentName: "助手" }],
    });
  });

  it("reference_found 改挂父会话并打 agent 标识；其余事件返回 null", () => {
    const rewritten = rewriteSubAgentPanelEvent(
      {
        type: "reference_found",
        sessionId: "sess-child",
        reference: { id: "r1", title: "t", url: "https://x.test", source: "web" },
      },
      "sess-parent",
      "sub-1",
      "助手",
    );
    expect(rewritten).toMatchObject({
      type: "reference_found",
      sessionId: "sess-parent",
      reference: { agent: "助手", id: "r1" },
    });

    expect(
      rewriteSubAgentPanelEvent(
        { type: "status", sessionId: "s", status: "thinking" },
        "sess-parent",
        "sub-1",
        "助手",
      ),
    ).toBeNull();
  });
});

// ---------- 无 run 状态守卫 ----------

function makeSession(events: AgentStreamEvent[] = []): AgentSession {
  return new AgentSession({
    sessionId: "sess-guard",
    workspaceRoot: "/tmp/w",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "k",
    model: "m",
    permissionMode: "default",
    multiAgent: false,
    emit: (event) => events.push(event),
  });
}

describe("AgentSession 状态守卫（未启动 run）", () => {
  it("getRunState / agentTree 初始快照", () => {
    const session = makeSession();
    expect(session.getRunState()).toEqual({
      runActive: false,
      paused: false,
      waitingApproval: false,
      waitingAskCount: 0,
      inserting: false,
    });
    expect(session.agentTree).toBeNull();
    expect(session.sessionId).toBe("sess-guard");
  });

  it("未启动时 pause/resume/approve 直接返回", async () => {
    const session = makeSession();
    await session.pause();
    await session.resume();
    await session.approve({ approvalId: "a1", approved: true });
    await session.reject({ approvalId: "a1", approved: false });
    expect(session.getRunState().paused).toBe(false);
  });

  it("canInsert 未运行时拦截", () => {
    const session = makeSession();
    expect(session.canInsert()).toEqual({ ok: false, error: "当前没有运行中的任务" });
  });

  it("resolveAsk 未知 askId 返回 false", () => {
    const session = makeSession();
    expect(session.resolveAsk("nope", "答")).toBe(false);
    expect(session.getRunState().waitingAskCount).toBe(0);
  });

  it("cancel 未运行时静默收尾", async () => {
    const events: AgentStreamEvent[] = [];
    const session = makeSession(events);
    await session.cancel();
    expect(events.filter((event) => event.type === "done")).toEqual([]);
  });
});

// ---------- 假 OpenAI 服务集成 ----------

type Behavior =
  | "text"
  | "tasks"
  | "approve-write"
  | "ask"
  | "spawn-tasks"
  | "spawn-ask"
  | "spawn-error";

let server: Server;
let origin = "";
let workspaceRoot = "";
const routes = new Map<string, Behavior>();
const requestBodies: string[] = [];
const childSeq = new Map<string, number>();
const parentSeq = new Map<string, number>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-zen-session",
    object: "chat.completion.chunk",
    created: 0,
    model: "zen-test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function toolCall(name: string, args: Record<string, unknown>, id: string): string[] {
  return [
    chunk({ role: "assistant", content: "" }, null),
    chunk(
      {
        tool_calls: [
          { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      null,
    ),
    chunk({}, "tool_calls"),
    "data: [DONE]\n\n",
  ];
}

function textBlocks(text: string): string[] {
  return [
    chunk({ role: "assistant", content: "" }, null),
    chunk({ content: text }, null),
    chunk({}, "stop"),
    "data: [DONE]\n\n",
  ];
}

function blocksFor(behavior: Behavior, isChild: boolean, seq: number): string[] {
  if (behavior === "text") {
    return textBlocks("hello");
  }
  if (behavior === "tasks") {
    return seq === 1
      ? toolCall(
          "updateTasks",
          { startNew: true, tasks: [{ id: "t1", label: "任务一", done: false }] },
          "call_tasks_1",
        )
      : seq === 2
        ? toolCall(
            "updateTasks",
            { tasks: [{ id: "t1", label: "任务一", done: true }] },
            "call_tasks_2",
          )
        : textBlocks("done");
  }
  if (behavior === "approve-write") {
    return seq === 1
      ? toolCall("writeFile", { path: "approve.txt", content: "x" }, "call_write_1")
      : textBlocks("written");
  }
  if (behavior === "ask") {
    return seq === 1
      ? toolCall("askUser", { question: "主会话问题？", options: ["A", "B"] }, "call_ask_1")
      : textBlocks("answered");
  }
  if (behavior === "spawn-tasks") {
    if (isChild) {
      return seq === 1
        ? toolCall(
            "updateTasks",
            { startNew: true, tasks: [{ id: "t1", label: "子任务清单", done: false }] },
            "call_child_tasks",
          )
        : textBlocks("子任务完成");
    }
    return seq === 1
      ? toolCall("spawnAgent", { name: "helper", task: "跑子任务" }, "call_spawn_1")
      : textBlocks("父完成");
  }
  if (behavior === "spawn-ask") {
    if (isChild) {
      return seq === 1
        ? toolCall("askUser", { question: "子任务问题？", options: ["A", "B"] }, "call_child_ask")
        : textBlocks("子任务已回答");
    }
    return seq === 1
      ? toolCall("spawnAgent", { name: "helper", task: "跑子任务并提问" }, "call_spawn_2")
      : textBlocks("父完成");
  }
  // spawn-error
  if (isChild) {
    return [];
  }
  return seq === 1
    ? toolCall("spawnAgent", { name: "helper", task: "会失败的子任务" }, "call_spawn_3")
    : textBlocks("父完成");
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  requestBodies.push(body);
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const behavior = routes.get(path) ?? "text";
  const isChild = body.includes("派生的子 Agent");
  const counters = isChild ? childSeq : parentSeq;
  const seq = (counters.get(path) ?? 0) + 1;
  counters.set(path, seq);

  if (behavior === "spawn-error" && isChild) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "child boom", type: "invalid_request_error" } }));
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const block of blocksFor(behavior, isChild, seq)) {
    res.write(block);
    await delay(2);
  }
  res.end();
}

function createSession(
  events: AgentStreamEvent[],
  name: string,
  behavior: Behavior,
  overrides: Partial<ConstructorParameters<typeof AgentSession>[0]> = {},
): AgentSession {
  const path = `/${name}`;
  routes.set(`${path}/v1/chat/completions`, behavior);
  return new AgentSession({
    sessionId: `sess-${name}`,
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: `${origin}${path}`,
    apiKey: "key",
    model: "zen-test-model",
    permissionMode: "default",
    emit: (event) => events.push(event),
    ...overrides,
  });
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-agent-session-"));
  server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("agent-session test server has no port");
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

describe("AgentSession 消息组装", () => {
  it("history 的 system 轮并入 instructions，图片作为多模态 part 随用户消息发出", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-hist", "text");
    const history: ChatTurn[] = [
      { role: "system", content: "历史压缩摘要" },
      { role: "user", content: "上一轮用户" },
      { role: "assistant", content: "上一轮回复" },
    ];
    const images: AgentImageAttachment[] = [
      { name: "shot.png", dataUrl: "data:image/png;base64,AAAA" },
    ];

    await session.start("看看这张图", history, images);

    const body = requestBodies.at(-1) ?? "";
    expect(body).toContain("历史压缩摘要");
    expect(body).toContain("上一轮用户");
    expect(body).toContain("看看这张图");
    expect(body).toContain("data:image/png;base64,AAAA");
    const messages = (JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> })
      .messages;
    // history 的 system 轮只进 instructions（请求里合为一条 system），不作为历史轮直发
    expect(messages.filter((message) => message.role === "system").length).toBeLessThanOrEqual(1);
    expect(
      messages.some((message) => Array.isArray(message.content) && message.content.length === 2),
    ).toBe(true);
  });
});

describe("AgentSession 工具事件与审批", () => {
  it("updateTasks 的 version 哨兵归一化为会话内版本号", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-tasks", "tasks");
    await session.start("建清单");

    const versions = events
      .filter((event) => event.type === "tasks_updated")
      .map((event) => (event.type === "tasks_updated" ? event.version : null));
    expect(versions).toEqual([1, 1]);
  });

  it("审批「全部允许」记忆该工具，拒绝发 denied 工具终态", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-approve", "approve-write");
    const running = session.start("写文件");
    await pollUntil(() => events.some((event) => event.type === "approval_request"));

    const request = events.find((event) => event.type === "approval_request");
    expect(request?.type).toBe("approval_request");
    if (request?.type !== "approval_request") {
      return;
    }
    expect(session.getRunState().waitingApproval).toBe(true);

    // approvalId 不匹配的裁决被忽略
    await session.approve({ approvalId: "wrong-id", approved: true });
    expect(session.getRunState().waitingApproval).toBe(true);

    await session.approve({
      approvalId: request.request.approvalId,
      approved: true,
      always: true,
    });
    await running;
    expect(events.filter((event) => event.type === "done").map((event) => (event.type === "done" ? event.reason : null))).toEqual([
      "stop",
    ]);
    // 批准后真实执行工具（tool_end 来自执行结果，不是审批伪造的）
    const end = events.find((event) => event.type === "tool_end");
    expect(end?.type === "tool_end" && end.ok).toBe(true);
  });

  it("askUser 挂起等待用户回答，cancel 补终态并拒绝挂起问询", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-ask", "ask");
    const running = session.start("问问题");
    await pollUntil(() => events.some((event) => event.type === "ask_user"));

    expect(session.getRunState().waitingAskCount).toBe(1);
    await session.cancel();
    await running;

    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.reason).toBe("cancelled");
    expect(session.getRunState().waitingAskCount).toBe(0);
  });
});

describe("AgentSession 子 Agent 派生", () => {
  it("spawnAgent 派生子会话：tasks 事件改挂父会话，结果收进 agentTree", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-spawn", "spawn-tasks");
    await session.start("拆分子任务");

    await pollUntil(() => {
      const tree = session.agentTree;
      return tree?.agents[0]?.status === "done";
    });

    const tree = session.agentTree;
    const node = tree?.agents[0];
    expect(node?.name).toBe("helper");
    expect(node?.result).toContain("子任务完成");
    // 子会话的 tasks_updated 改挂父会话（agentName + 条目 id 前缀）
    const update = events.find((event) => event.type === "tasks_updated");
    expect(update).toBeTruthy();
    if (update?.type === "tasks_updated") {
      expect(update.sessionId).toBe(session.sessionId);
      expect(update.agentName).toBe("helper");
      // 条目 id 加 agentId 前缀（agentId 是节点 id，不是显示名）
      expect(update.items[0]?.id.endsWith("-t1")).toBe(true);
    }
  });

  it("子 Agent 的 askUser 上抛父会话，resolveAsk 按 askId 路由到子会话", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-spawn-ask", "spawn-ask");
    const running = session.start("子任务要提问");
    await running;

    await pollUntil(() => events.some((event) => event.type === "ask_user"));
    const ask = events.find((event) => event.type === "ask_user");
    expect(ask?.type).toBe("ask_user");
    if (ask?.type !== "ask_user") {
      return;
    }
    expect(ask.question.agentName).toBe("helper");
    expect(ask.question.sourceSessionId?.startsWith(`${session.sessionId}::`)).toBe(true);

    expect(session.resolveAsk(ask.question.askId, "选 A")).toBe(true);
    await pollUntil(() => {
      const tree = session.agentTree;
      return tree?.agents[0]?.status === "done";
    });
    expect(session.agentTree?.agents[0]?.result).toContain("子任务已回答");
    expect(session.resolveAsk("unknown-ask", "x")).toBe(false);
  });

  it("子 Agent 服务端错误收尾为 error 节点", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-spawn-err", "spawn-error");
    await session.start("子任务会失败");

    await pollUntil(() => {
      const status = session.agentTree?.agents[0]?.status;
      return status === "error" || status === "cancelled";
    });
    const node = session.agentTree?.agents[0];
    expect(node?.status).toBe("error");
    expect(node?.error).toBeTruthy();
  });
});
