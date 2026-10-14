import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  | "spawn-error"
  | "overflow-retry"
  | "auto-compact"
  | "compact-reinject"
  | "repair-tool-input"
  | "repair-tool-name"
  | "missing-finish-reason";

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

/** 带 usage 的收尾 chunk（步间主动压缩依赖 finish-step 的真实输入 tokens） */
function chunkWithUsage(finishReason: string | null, usage: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-zen-session",
    object: "chat.completion.chunk",
    created: 0,
    model: "zen-test-model",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage,
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
  // 步间主动压缩：第 1 步工具调用并回传大 usage（900/1000 窗口 ≥ 75% 阈值），第 2 步正常完成
  if (behavior === "auto-compact") {
    if (seq === 1) {
      return [
        chunk({ role: "assistant", content: "" }, null),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_ac_1",
              type: "function",
              function: {
                name: "updateTasks",
                arguments: JSON.stringify({ tasks: [{ id: "t1", label: "清单", done: false }] }),
              },
            },
          ],
        }, null),
        chunkWithUsage("tool_calls", { prompt_tokens: 900, completion_tokens: 10 }),
        "data: [DONE]\n\n",
      ];
    }
    return textBlocks("完成");
  }
  // 压缩回灌：第 1 步 readFile，随后多步工具调用把它推出尾窗，第 7 步回传大 usage 触发压缩
  if (behavior === "compact-reinject") {
    if (seq === 1) {
      return toolCall("readFile", { path: "note.md" }, "call_rf_1");
    }
    if (seq < 7) {
      return toolCall(
        "updateTasks",
        { tasks: [{ id: "t1", label: `步骤${seq}`, done: false }] },
        `call_step_${seq}`,
      );
    }
    if (seq === 7) {
      return [
        chunk({ role: "assistant", content: "" }, null),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_step_7",
              type: "function",
              function: {
                name: "updateTasks",
                arguments: JSON.stringify({ tasks: [{ id: "t1", label: "步骤7", done: false }] }),
              },
            },
          ],
        }, null),
        chunkWithUsage("tool_calls", { prompt_tokens: 900, completion_tokens: 10 }),
        "data: [DONE]\n\n",
      ];
    }
    return textBlocks("完成");
  }
  // GPT 系修复：入参字段名写错（缺必填 tasks）→ repairToolCall 模型重写 → 工具执行成功
  if (behavior === "repair-tool-input") {
    return seq === 1
      ? toolCall("updateTasks", { task: [{ id: "t1", label: "坏字段", done: false }] }, "call_repair_1")
      : textBlocks("done");
  }
  // 工具名被写成 snake_case → NoSuchTool 归一化修复（不产生修复请求）
  if (behavior === "repair-tool-name") {
    return seq === 1
      ? toolCall(
          "update_tasks",
          { startNew: true, tasks: [{ id: "t1", label: "改名修复", done: false }] },
          "call_name_1",
        )
      : textBlocks("done");
  }
  // 流结束缺 finish_reason：半截工具步被丢弃重放（第二次请求正常带 finish_reason），
  // 工具走正常执行流续跑，而不是 error 终态
  if (behavior === "missing-finish-reason") {
    if (seq === 1) {
      return [
        chunk({ role: "assistant", content: "" }, null),
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: "call_mf_1",
                type: "function",
                function: {
                  name: "updateTasks",
                  arguments: JSON.stringify({
                    startNew: true,
                    tasks: [{ id: "t1", label: "无finish", done: false }],
                  }),
                },
              },
            ],
          },
          null,
        ),
        chunk({}, null),
        "data: [DONE]\n\n",
      ];
    }
    if (seq === 2) {
      // 重放的本步：代理这次收尾正常，同一工具调用带 finish_reason 重发
      return toolCall(
        "updateTasks",
        { startNew: true, tasks: [{ id: "t1", label: "无finish", done: false }] },
        "call_mf_2",
      );
    }
    return textBlocks("完成");
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
  // 上下文超限：首次请求返回 400 超限报错，等 agent-core 裁剪重试后走正常流
  if (behavior === "overflow-retry" && seq === 1) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "This model's maximum context length is 8192 tokens. However, you requested 20000 tokens (19000 in the messages, 1000 in the completion). Please reduce the length of the messages or completion.",
        },
        type: "invalid_request_error",
      }),
    );
    return;
  }
  // repairToolCall 的结构化重写请求（generateText 非流式）：返回修正后的入参 JSON。
  // 按请求体识别（含修复提示词），与 seq 计数解耦——修复请求会占用一个 seq。
  if (behavior === "repair-tool-input" && body.includes("tried to call the tool")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-zen-repair",
        object: "chat.completion",
        created: 0,
        model: "zen-test-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                startNew: true,
                tasks: [{ id: "t1", label: "修复后", done: false }],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
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

describe("AgentSession 上下文超限自动恢复", () => {
  it("首次超限报错 → 确定性裁剪历史 → 重试成功并上报 context_overflow", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const filler = "x".repeat(2000);
    const history: ChatTurn[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push({ role: "user", content: `旧问题${i} ${filler}` });
      history.push({ role: "assistant", content: `旧回答${i} ${filler}` });
    }
    const session = createSession(events, "sess-overflow", "overflow-retry");
    await session.start("当前任务", history);

    const overflowEvents = events.filter((event) => event.type === "context_overflow");
    expect(overflowEvents).toHaveLength(1);
    expect(overflowEvents[0]?.type === "context_overflow" && overflowEvents[0].phase).toBe(
      "retrying",
    );
    expect(
      overflowEvents[0]?.type === "context_overflow" && overflowEvents[0].droppedMessages,
    ).toBeGreaterThan(0);
    // 重试成功：正常完成而非 error 终态
    expect(
      events.some((event) => event.type === "done" && event.reason === "stop"),
    ).toBe(true);
    // 裁剪生效：重试请求的消息数少于首次请求，且当前任务仍在
    const bodies = requestBodies.map(
      (body) =>
        (JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> }).messages,
    );
    expect(bodies.length).toBe(2);
    const firstMessages = bodies[0];
    const retryMessages = bodies[1];
    expect(firstMessages).toBeDefined();
    expect(retryMessages).toBeDefined();
    if (!firstMessages || !retryMessages) {
      return;
    }
    expect(retryMessages.length).toBeLessThan(firstMessages.length);
    const retryBody = requestBodies.at(-1) ?? "";
    expect(retryBody).toContain("当前任务");
    expect(retryBody).not.toContain("旧问题0");
  });

  it("无可裁剪内容（单条超大 prompt）不重发：上报 failed 并收尾 error", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-overflow-none", "overflow-retry");
    await session.start("短任务");

    expect(
      events.some(
        (event) => event.type === "context_overflow" && event.phase === "failed",
      ),
    ).toBe(true);
    expect(
      events.some((event) => event.type === "done" && event.reason === "error"),
    ).toBe(true);
    // 只发过一次请求（不重发注定失败的请求）
    expect(requestBodies.length).toBe(1);
  });
});

describe("AgentSession 步间主动压缩", () => {
  function bigHistory(): ChatTurn[] {
    const filler = "x".repeat(1500);
    const history: ChatTurn[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push({ role: "user", content: `旧问题${i} ${filler}` });
      history.push({ role: "assistant", content: `旧回答${i} ${filler}` });
    }
    return history;
  }

  it("usage 逼近窗口：步间 LLM 摘要压缩，重试请求含摘要且无早期历史", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-autocompact", "auto-compact", {
      contextWindow: 1000,
      summarizeHistory: async () => "摘要：用户此前处理过若干旧问题；当前任务是继续完成工作。",
    });
    await session.start("当前任务", bigHistory());

    console.log(
      "DEBUG events:",
      JSON.stringify(
        events.map((event) =>
          event.type === "usage" ? event : { type: event.type },
        ),
      ),
    );

    const compacted = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "context_compacted" }> =>
        event.type === "context_compacted",
    );
    expect(compacted?.mode).toBe("llm");
    expect(compacted?.droppedMessages).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "done" && event.reason === "stop")).toBe(true);
    // 压缩后的第二次请求：摘要进 instructions，早期历史不再直发，尾部与当前任务保留
    expect(requestBodies.length).toBe(2);
    const retryBody = requestBodies.at(-1) ?? "";
    expect(retryBody).toContain("上下文已压缩");
    expect(retryBody).toContain("用户此前处理过若干旧问题");
    // 任务清单跨压缩存活：updateTasks 在压缩前执行，清单注入 instructions
    expect(retryBody).toContain("上下文任务清单");
    expect(retryBody).toContain("t1 清单");
    expect(retryBody).not.toContain("旧问题0");
    expect(retryBody).toContain("当前任务");
  });

  it("未知 contextWindow 不主动压缩：全量直发且摘要器未被调用", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-autocompact-off", "auto-compact", {
      summarizeHistory: async () => "不应被调用",
    });
    await session.start("当前任务", bigHistory());

    expect(events.some((event) => event.type === "context_compacted")).toBe(false);
    expect(
      requestBodies.some((body) => body.includes("不应被调用")),
    ).toBe(false);
    // 两次请求都携带全量历史（未压缩）
    expect(
      requestBodies.every((body) => body.includes("旧问题0") && body.includes("当前任务")),
    ).toBe(true);
  });

  it("摘要失败回退确定性裁剪并继续 run", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-autocompact-fb", "auto-compact", {
      contextWindow: 1000,
      summarizeHistory: async () => null,
    });
    await session.start("当前任务", bigHistory());

    const compacted = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "context_compacted" }> =>
        event.type === "context_compacted",
    );
    expect(compacted?.mode).toBe("deterministic");
    expect(compacted?.droppedMessages).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "done" && event.reason === "stop")).toBe(true);
    const retryBody = requestBodies.at(-1) ?? "";
    expect(retryBody).not.toContain("旧问题0");
    expect(retryBody).toContain("当前任务");
  });

  it("压缩回灌：早期 readFile 的文件被重读注入 instructions（超长截断）", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const content = "回灌标记内容\n" + "f".repeat(5000);
    writeFileSync(join(workspaceRoot, "note.md"), content, "utf8");
    const session = createSession(events, "sess-reinject", "compact-reinject", {
      contextWindow: 1000,
      permissionMode: "full",
      summarizeHistory: async () => "摘要：曾读取 note.md 并维护任务清单。",
    });
    await session.start("当前任务");

    const compacted = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "context_compacted" }> =>
        event.type === "context_compacted",
    );
    expect(compacted?.mode).toBe("llm");
    expect(events.some((event) => event.type === "done" && event.reason === "stop")).toBe(true);
    // 回灌生效：重读当前内容进 instructions，超长部分截断并留路径提示；任务清单同样在
    const retryBody = requestBodies.at(-1) ?? "";
    expect(retryBody).toContain("压缩回灌 · 最近触及的文件");
    expect(retryBody).toContain("回灌标记内容");
    expect(retryBody).toContain("已截断，完整文件仍在 note.md");
    expect(retryBody).toContain("上下文任务清单");
    expect(retryBody).toContain("步骤7");
    // readFile 那一步已被摘要进 head：早期历史不再直发
    expect(retryBody).not.toContain("旧问题0");
  });
});

describe("GPT 系工具调用修复与缺 finish_reason 兜底", () => {
  it("入参不合 schema：repairToolCall 模型重写后执行，无 error 事件", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-repair-input", "repair-tool-input");
    await session.start("建清单");

    // 确实发起过一次模型结构化重写请求
    expect(requestBodies.some((body) => body.includes("tried to call the tool"))).toBe(true);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.some((event) => event.type === "tasks_updated")).toBe(true);
    const toolEnds = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "tool_end" }> =>
        event.type === "tool_end",
    );
    expect(toolEnds.length).toBeGreaterThan(0);
    expect(toolEnds.every((event) => event.ok)).toBe(true);
    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.reason).toBe("stop");
  });

  it("工具名 snake_case 变形：归一化修复后执行，无修复请求与 error 事件", async () => {
    const events: AgentStreamEvent[] = [];
    requestBodies.length = 0;
    const session = createSession(events, "sess-repair-name", "repair-tool-name");
    await session.start("建清单");

    expect(requestBodies.some((body) => body.includes("tried to call the tool"))).toBe(false);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.some((event) => event.type === "tasks_updated")).toBe(true);
    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.reason).toBe("stop");
  });

  it("流缺 finish_reason 但工具已完整产出：不误报 error，续跑后 stop 收尾", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "sess-missing-finish", "missing-finish-reason");
    await session.start("建清单");

    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.some((event) => event.type === "tasks_updated")).toBe(true);
    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.reason).toBe("stop");
  });
});
