import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { AgentSession } from "./index";

/**
 * 状态链路回归（事件序）：
 * - 服务端错误只发 error + done(error)
 * - 暂停不发 done；取消补 done(cancelled)，未完成工具有 tool_end 终态
 * - 审批拒绝发 denied tool_end；通过不发 synthetic ok tool_end
 * - workspace 使用临时目录，避免测试写入仓库
 */

const MODEL_ID = "zen-test-model";
const API_KEY = "zen-test-key";
let server: Server;
let origin = "";
let workspaceRoot = "";

type RouteKind = "ok" | "http-error" | "write-tool" | "terminal-tool" | "error-tool" | "edit-miss" | "slow" | "tool-loop" | "terminal-slow";

const routes = new Map<string, RouteKind>();
/** tool-loop 路由的请求计数：每次请求返回唯一 toolCallId，模拟持续调工具的模型 */
let toolLoopSeq = 0;

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
    id: "chatcmpl-zen-life",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function blocksFor(kind: RouteKind): string[] {
  if (kind === "http-error") {
    return [];
  }
  if (kind === "write-tool") {
    return [
      chunk({ role: "assistant", content: "" }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: "call_write_1",
              type: "function",
              function: {
                name: "writeFile",
                arguments: JSON.stringify({ path: "zen-lifecycle-tmp.txt", content: "hello from test" }),
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
  if (kind === "terminal-tool" || kind === "error-tool" || kind === "edit-miss") {
    const toolName = kind === "terminal-tool" ? "runTerminal" : kind === "edit-miss" ? "editFile" : "writeFile";
    const args =
      kind === "terminal-tool"
        ? { command: "printf failure >&2; exit 7" }
        : kind === "edit-miss"
          ? { path: "edit-miss.txt", oldString: "missing", newString: "new" }
          : { path: "missing-parent/file.txt", content: "never written" };
    return [
      chunk({ role: "assistant", content: "" }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: kind === "terminal-tool" ? "call_terminal_1" : "call_error_1",
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        null,
      ),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ];
  }
  if (kind === "terminal-slow") {
    return [
      chunk({ role: "assistant", content: "" }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: "call_terminal_slow_1",
              type: "function",
              function: { name: "runTerminal", arguments: JSON.stringify({ command: "sleep 30" }) },
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
  if (kind === "tool-loop") {
    toolLoopSeq += 1;
    return [
      chunk({ role: "assistant", content: "" }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: `call_loop_${toolLoopSeq}`,
              type: "function",
              function: { name: "readFile", arguments: JSON.stringify({ path: "loop.txt" }) },
            },
          ],
        },
        null,
      ),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ];
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
  if (kind === "http-error") {
    // 400：客户端错误通常不重试，应立刻进入 error 终态
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad request from test server", type: "invalid_request_error" } }));
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const blocks = blocksFor(kind);
  const stepMs = kind === "slow" ? 30 : 2;
  for (const block of blocks) {
    res.write(block);
    await delay(stepMs);
  }
  res.end();
}

function createSession(events: AgentStreamEvent[], name: string, kind: RouteKind): AgentSession {
  // openai-chat → openai-compatible；withVersionSegment 会在 baseUrl 后补 /v1，再拼 /chat/completions
  const path = `/${name}`;
  routes.set(`${path}/v1/chat/completions`, kind);
  return new AgentSession({
    sessionId: `life-${name}`,
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: `${origin}${path}`,
    apiKey: API_KEY,
    model: MODEL_ID,
    permissionMode: "default",
    emit: (event) => events.push(event),
  });
}

function doneReasons(events: AgentStreamEvent[]): string[] {
  return events
    .filter((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")
    .map((e) => e.reason);
}

function toolEnds(events: AgentStreamEvent[]): Extract<AgentStreamEvent, { type: "tool_end" }>[] {
  return events.filter((e): e is Extract<AgentStreamEvent, { type: "tool_end" }> => e.type === "tool_end");
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-agent-life-"));
  server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("lifecycle test server has no port");
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

describe("AgentSession 状态链路", () => {
  it(
    "服务端错误只发 error + done(error)，不被 stop 覆盖",
    async () => {
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, "life-err", "http-error");
      await session.start("boom please");

      const errors = events.filter((e) => e.type === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(doneReasons(events)).toEqual(["error"]);
      expect(events.at(-1)?.type).toBe("done");
    },
    15_000,
  );

  it("正常结束发 done(stop)", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-ok", "ok");
    await session.start("hello");
    expect(doneReasons(events)).toEqual(["stop"]);
  });

  it("步数预算耗尽自动续跑，run 上限才发 done(max_steps)，不伪装成 stop", async () => {
    const events: AgentStreamEvent[] = [];
    writeFileSync(join(workspaceRoot, "loop.txt"), "loop");
    const session = createSession(events, "life-loop", "tool-loop");
    await session.start("keep calling the tool");

    // 单次 stream 预算是 30 步：步数远超 30 说明预算耗尽后自动续跑了
    const stepStarts = events.filter((event) => event.type === "step_start").length;
    expect(stepStarts).toBeGreaterThan(30);
    // 从不中途发 done，直到 run 总预算耗尽才以 max_steps 终止
    expect(doneReasons(events)).toEqual(["max_steps"]);
    expect(events.at(-1)?.type).toBe("done");
  }, 30_000);

  it("暂停不发 done，取消后补 done(cancelled) 与工具终态", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-slow", "slow");
    const started = session.start("long running");
    await delay(80);
    await session.pause();
    await started;

    expect(doneReasons(events)).toEqual([]);
    expect(events.some((e) => e.type === "status" && e.status === "paused")).toBe(true);

    await session.cancel();
    expect(doneReasons(events)).toEqual(["cancelled"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("工具执行中暂停立即生效：runTerminal 被 abort 中断，不发 done 也不误报 error", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-terminal-pause", "terminal-slow");
    const run = session.start("run long command");
    await delay(150);
    const request = events.find((e) => e.type === "approval_request");
    if (request?.type !== "approval_request") throw new Error("missing terminal approval");
    // approve 内部会 continueLoop 并阻塞在长命令上，不能 await
    const approved = session.approve({ approvalId: request.request.approvalId, approved: true });
    // 等命令真正开跑（tool_start 已到）
    await delay(500);
    expect(events.some((e) => e.type === "tool_start" && e.toolName === "runTerminal")).toBe(true);

    const t0 = Date.now();
    await session.pause();
    await Promise.all([approved, run]);
    const elapsed = Date.now() - t0;

    // 暂停必须在秒级内生效（修复前会卡到 sleep 30 结束）
    expect(elapsed).toBeLessThan(5000);
    expect(events.some((e) => e.type === "status" && e.status === "paused")).toBe(true);
    expect(doneReasons(events)).toEqual([]);
    expect(events.some((e) => e.type === "error")).toBe(false);
  }, 15_000);

  it("终端非零退出发 error tool_end 并保留输出", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-terminal-error", "terminal-tool");
    const run = session.start("run failing command");
    await delay(150);
    const request = events.find((event) => event.type === "approval_request");
    if (request?.type !== "approval_request") throw new Error("missing terminal approval");
    await session.approve({ approvalId: request.request.approvalId, approved: true });
    await run;

    const end = toolEnds(events).find((event) => event.toolName === "runTerminal");
    expect(end).toMatchObject({ ok: false, state: "error" });
    expect(end?.output).toEqual({ ok: false, exitCode: 7, output: "[stderr]\nfailure" });
  });

  it("tool-error 发 error tool_end 并保留 SDK 原始错误", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-tool-error", "error-tool");
    const run = session.start("write failing file");
    await delay(150);
    const request = events.find((event) => event.type === "approval_request");
    if (request?.type !== "approval_request") throw new Error("missing write approval");
    await session.approve({ approvalId: request.request.approvalId, approved: true });
    await run;

    const end = toolEnds(events).find((event) => event.toolName === "writeFile");
    expect(end?.ok).toBe(false);
    expect(end?.state).toBe("error");
    expect(end?.summary).toContain("failed to write");
    expect(end?.output).toBe(end?.summary);
    expect(JSON.parse(JSON.stringify(end)).output).toBe(end?.summary);
    expect(toolEnds(events).some((event) => event.ok)).toBe(false);
  });

  it("writeFile 透传创建和覆盖快照，editFile 无命中只发失败", async () => {
    for (const before of [null, "changed immediately before execution"]) {
      const path = join(workspaceRoot, "zen-lifecycle-tmp.txt");
      if (before === null) rmSync(path, { force: true });
      else writeFileSync(path, before);
      const events: AgentStreamEvent[] = [];
      const session = createSession(events, `snapshot-${before === null ? "create" : "overwrite"}`, "write-tool");
      const run = session.start("write snapshot");
      await delay(150);
      const request = events.find((event) => event.type === "approval_request");
      if (request?.type !== "approval_request") throw new Error("missing snapshot approval");
      await session.approve({ approvalId: request.request.approvalId, approved: true });
      await run;
      expect(toolEnds(events)[0]).toMatchObject({
        ok: true,
        output: { path: "zen-lifecycle-tmp.txt", content: "hello from test", before, after: "hello from test" },
      });
    }

    writeFileSync(join(workspaceRoot, "edit-miss.txt"), "unchanged");
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "edit-miss", "edit-miss");
    const run = session.start("edit missing text");
    await delay(150);
    const request = events.find((event) => event.type === "approval_request");
    if (request?.type !== "approval_request") throw new Error("missing edit approval");
    await session.approve({ approvalId: request.request.approvalId, approved: true });
    await run;
    expect(toolEnds(events)[0]).toMatchObject({ ok: false, state: "error" });
    expect(toolEnds(events)[0]?.summary).toContain("oldString not found");
    expect(toolEnds(events).some((event) => event.ok)).toBe(false);
    expect(readFileSync(join(workspaceRoot, "edit-miss.txt"), "utf8")).toBe("unchanged");
  });

  it("审批拒绝发 denied tool_end；通过不发 synthetic ok tool_end", async () => {
    const deniedEvents: AgentStreamEvent[] = [];
    const deniedSession = createSession(deniedEvents, "life-deny", "write-tool");
    const deniedRun = deniedSession.start("please write file");
    await delay(150);

    const request = deniedEvents.find((e) => e.type === "approval_request");
    if (request?.type !== "approval_request") {
      throw new Error(`missing approval_request, events=${JSON.stringify(deniedEvents.map((e) => e.type))}`);
    }
    await deniedSession.approve({
      approvalId: request.request.approvalId,
      approved: false,
      reason: "不要执行",
    });
    await deniedRun;

    const deniedEnds = toolEnds(deniedEvents).filter((e) => e.toolCallId === request.request.toolCallId);
    expect(deniedEnds.some((e) => e.state === "denied" || e.ok === false)).toBe(true);
    expect(deniedEnds.some((e) => e.state === "ok" || e.summary === "审批通过")).toBe(false);
    expect(
      deniedEvents.some(
        (e) => e.type === "approval_resolved" && e.approved === false && e.toolCallId === request.request.toolCallId,
      ),
    ).toBe(true);

    const approvedEvents: AgentStreamEvent[] = [];
    const approvedSession = createSession(approvedEvents, "life-approve", "write-tool");
    const approvedRun = approvedSession.start("please write file again");
    await delay(150);
    const approvedRequest = approvedEvents.find((e) => e.type === "approval_request");
    if (approvedRequest?.type !== "approval_request") {
      throw new Error(
        `missing approval_request on approve path, events=${JSON.stringify(approvedEvents.map((e) => e.type))}`,
      );
    }
    await approvedSession.approve({
      approvalId: approvedRequest.request.approvalId,
      approved: true,
    });
    await approvedRun;

    const approvedEnds = toolEnds(approvedEvents).filter(
      (e) => e.toolCallId === approvedRequest.request.toolCallId,
    );
    expect(approvedEnds.some((e) => e.state === "ok" && e.summary === "审批通过")).toBe(false);
    expect(approvedEnds.every((e) => e.summary !== "审批通过")).toBe(true);
  });

  it("等审批时取消：未完成工具补 cancelled tool_end", async () => {
    const events: AgentStreamEvent[] = [];
    const session = createSession(events, "life-approval-cancel", "write-tool");
    const run = session.start("need write approval");
    await delay(150);
    const request = events.find((e) => e.type === "approval_request");
    if (request?.type !== "approval_request") {
      throw new Error(`missing approval_request, events=${JSON.stringify(events.map((e) => e.type))}`);
    }
    await session.cancel();
    await run;

    const ends = toolEnds(events).filter((e) => e.toolCallId === request.request.toolCallId);
    expect(ends.some((e) => e.state === "cancelled")).toBe(true);
    expect(doneReasons(events)).toEqual(["cancelled"]);
  });
});
