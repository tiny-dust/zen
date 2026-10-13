import { describe, expect, it, vi } from "vitest";

import type { AgentRunRequest, PermissionMode, SessionMode } from "@zen/shared";
import { DEFAULT_SESSION_MODE, PLAN_APPROVAL_MESSAGE } from "@zen/shared";

import {
  appendSessionModeDirective,
  isPlanApproval,
  resolveRunSessionMode,
  sessionModeDirective,
} from "./session-mode";

describe("isPlanApproval", () => {
  it("approvePlan 标志直接视为批准", () => {
    expect(isPlanApproval("随便什么内容", true)).toBe(true);
  });

  it("手打「批准执行」（可带补充说明）视为批准", () => {
    expect(isPlanApproval(PLAN_APPROVAL_MESSAGE)).toBe(true);
    expect(isPlanApproval("  批准执行，但先改一下登录页  ")).toBe(true);
  });

  it("普通消息（含近似前缀）不视为批准", () => {
    expect(isPlanApproval("批准")).toBe(false);
    expect(isPlanApproval("计划不错，先别执行")).toBe(false);
    expect(isPlanApproval("")).toBe(false);
  });
});

describe("resolveRunSessionMode", () => {
  const request = (userMessage: string, approvePlan?: boolean) => ({
    userMessage,
    ...(approvePlan != null ? { approvePlan } : {}),
  });

  it("plan 模式收到批准：先落库切回 interactive，本次按 interactive 跑", () => {
    const persist = vi.fn();
    const mode = resolveRunSessionMode("plan", request(PLAN_APPROVAL_MESSAGE), persist);
    expect(mode).toBe("interactive");
    expect(persist).toHaveBeenCalledWith("interactive");
  });

  it("plan 模式的普通消息（计划反馈）：保持 plan 且不落库", () => {
    const persist = vi.fn();
    const mode = resolveRunSessionMode("plan", request("第二步拆细一点"), persist);
    expect(mode).toBe("plan");
    expect(persist).not.toHaveBeenCalled();
  });

  it("非 plan 模式即使带 approvePlan 也不落库切换", () => {
    const persist = vi.fn();
    expect(resolveRunSessionMode("autopilot", request("x", true), persist)).toBe("autopilot");
    expect(resolveRunSessionMode("interactive", request("x", true), persist)).toBe("interactive");
    expect(persist).not.toHaveBeenCalled();
  });

  it("未知/缺省值归一化为 interactive", () => {
    const persist = vi.fn();
    expect(resolveRunSessionMode(undefined, request("你好"), persist)).toBe(
      DEFAULT_SESSION_MODE,
    );
    expect(resolveRunSessionMode("bogus", request("你好"), persist)).toBe(DEFAULT_SESSION_MODE);
  });
});

describe("sessionModeDirective / appendSessionModeDirective", () => {
  const permission = "smart" as PermissionMode;

  it("interactive 不追加任何指令（现状行为不变）", () => {
    expect(sessionModeDirective("interactive", permission)).toBe("");
    expect(appendSessionModeDirective("基础提示词", "interactive", permission)).toBe(
      "基础提示词",
    );
  });

  it("plan 指令包含计划清单与等待批准的约束", () => {
    const directive = sessionModeDirective("plan", permission);
    expect(directive).toContain("计划模式");
    expect(directive).toContain("计划清单");
    expect(directive).toContain("禁止执行任何写入类操作");
    expect(directive).toContain(PLAN_APPROVAL_MESSAGE);
  });

  it("autopilot 指令包含自主推进与不绕过权限的约束", () => {
    const directive = sessionModeDirective("autopilot", permission);
    expect(directive).toContain("自动模式");
    expect(directive).toContain("智能权限");
    expect(directive).toContain("不要试图绕过或规避审批流程");
  });

  it("追加指令拼接在基础提示词之后；基础为空时直接返回指令", () => {
    const combined = appendSessionModeDirective("基础提示词", "plan" as SessionMode, permission);
    expect(combined.startsWith("基础提示词\n\n")).toBe(true);
    expect(combined).toContain("计划模式");
    expect(appendSessionModeDirective("", "plan", permission)).toBe(
      sessionModeDirective("plan", permission),
    );
  });

  it("AgentRunRequest 携带 approvePlan（类型契约）", () => {
    const req: AgentRunRequest = {
      sessionId: "s1",
      userMessage: PLAN_APPROVAL_MESSAGE,
      workspaceRoot: "",
      approvePlan: true,
    };
    expect(isPlanApproval(req.userMessage, req.approvePlan)).toBe(true);
  });
});
