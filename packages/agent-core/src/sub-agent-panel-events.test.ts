import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { rewriteSubAgentPanelEvent } from "./agent-session";

/**
 * 子 Agent 面板侧信道事件改写（rewriteSubAgentPanelEvent）：
 * - tasks_updated：sessionId → 父、version=0（父侧「更新当前版」语义）、
 *   事件与条目均带 agentName、item id 加 agentId 前缀防与主 Agent 冲突
 * - reference_found：sessionId → 父、reference.agent = 子 Agent 名
 * - 其余事件原样透传（返回 null），不污染父会话消息流
 */

const PARENT = "sess-parent";
const AGENT_ID = "agent-1";
const AGENT_NAME = "检索工";

describe("rewriteSubAgentPanelEvent tasks_updated 改写", () => {
  it("sessionId 改为父会话、version=0、agentName 与 id 前缀齐全", () => {
    const event: AgentStreamEvent = {
      type: "tasks_updated",
      sessionId: `${PARENT}::${AGENT_ID}`,
      version: 2,
      items: [
        { id: "t1", label: "扫描目录", done: true },
        { id: "t2", label: "汇总结果", done: false },
      ],
    };

    const rewritten = rewriteSubAgentPanelEvent(event, PARENT, AGENT_ID, AGENT_NAME);
    expect(rewritten?.type).toBe("tasks_updated");
    if (rewritten?.type !== "tasks_updated") {
      return;
    }
    expect(rewritten.sessionId).toBe(PARENT);
    expect(rewritten.version).toBe(0);
    expect(rewritten.agentName).toBe(AGENT_NAME);
    expect(rewritten.items).toEqual([
      { id: `${AGENT_ID}-t1`, label: "扫描目录", done: true, agentName: AGENT_NAME },
      { id: `${AGENT_ID}-t2`, label: "汇总结果", done: false, agentName: AGENT_NAME },
    ]);
    // 原事件不被原地修改
    expect(event.items[0]?.id).toBe("t1");
    expect(event.sessionId).toBe(`${PARENT}::${AGENT_ID}`);
  });

  it("条目已有 agentName 时以本次为准覆盖", () => {
    const event: AgentStreamEvent = {
      type: "tasks_updated",
      sessionId: `${PARENT}::${AGENT_ID}`,
      version: 0,
      items: [{ id: "t1", label: "x", done: false, agentName: "旧名" }],
    };

    const rewritten = rewriteSubAgentPanelEvent(event, PARENT, AGENT_ID, AGENT_NAME);
    if (rewritten?.type !== "tasks_updated") {
      throw new Error("expected tasks_updated");
    }
    expect(rewritten.items[0]).toMatchObject({ id: `${AGENT_ID}-t1`, agentName: AGENT_NAME });
  });
});

describe("rewriteSubAgentPanelEvent reference_found 改写", () => {
  it("sessionId 改为父会话，reference 打上 agent 标识，其余字段保留", () => {
    const event: AgentStreamEvent = {
      type: "reference_found",
      sessionId: `${PARENT}::${AGENT_ID}`,
      reference: {
        id: "r9",
        title: "Zen Repo",
        url: "https://example.com/zen",
        snippet: "monorepo",
        source: "web",
      },
    };

    const rewritten = rewriteSubAgentPanelEvent(event, PARENT, AGENT_ID, AGENT_NAME);
    expect(rewritten).toEqual({
      type: "reference_found",
      sessionId: PARENT,
      reference: {
        id: "r9",
        title: "Zen Repo",
        url: "https://example.com/zen",
        snippet: "monorepo",
        source: "web",
        agent: AGENT_NAME,
      },
    });
  });
});

describe("rewriteSubAgentPanelEvent 其余事件透传", () => {
  it("消息流/进程/问询等事件返回 null，走原路径不动", () => {
    const events: AgentStreamEvent[] = [
      { type: "delta", sessionId: `${PARENT}::${AGENT_ID}`, text: "hello" },
      {
        type: "tool_start",
        sessionId: `${PARENT}::${AGENT_ID}`,
        toolCallId: "call_1",
        toolName: "runTerminal",
        args: { command: "npm run dev" },
      },
      {
        type: "tool_end",
        sessionId: `${PARENT}::${AGENT_ID}`,
        toolCallId: "call_1",
        toolName: "runTerminal",
        ok: true,
        state: "ok",
        summary: "完成",
      },
      { type: "done", sessionId: `${PARENT}::${AGENT_ID}`, reason: "stop" },
      { type: "error", sessionId: `${PARENT}::${AGENT_ID}`, message: "boom" },
    ];

    for (const event of events) {
      expect(rewriteSubAgentPanelEvent(event, PARENT, AGENT_ID, AGENT_NAME)).toBeNull();
    }
  });
});
