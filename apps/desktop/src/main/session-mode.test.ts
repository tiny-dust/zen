import { describe, expect, it, vi } from "vitest";

import type { AgentRunRequest, PermissionMode, SessionMode } from "@zen/shared";
import { DEFAULT_SESSION_MODE, PLAN_APPROVAL_MESSAGE } from "@zen/shared";

import {
  appendPlanDirective,
  appendSessionModeDirective,
  buildPlanPrompt,
  isPlanApproval,
  resolveRunSessionMode,
  resolvePhaseModel,
  sessionModeDirective,
  shouldAutoPlan,
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

describe("resolvePhaseModel", () => {
  const session = {
    pairMode: true,
    planModelProviderId: "p-plan", planModelId: "m-plan",
    actModelProviderId: "p-act", actModelId: "m-act",
  } as Parameters<typeof resolvePhaseModel>[0];
  const fallback = { providerId: "default", modelId: "default-model" };

  it("Plan 使用规划模型，批准后 interactive 使用执行模型", () => {
    expect(resolvePhaseModel(session, "plan", fallback)).toEqual({ providerId: "p-plan", modelId: "m-plan" });
    expect(resolvePhaseModel(session, "interactive", fallback)).toEqual({ providerId: "p-act", modelId: "m-act" });
  });

  it("阶段未配置时保持原有模型选择", () => {
    expect(resolvePhaseModel({ ...session, actModelId: null }, "autopilot", fallback)).toEqual(fallback);
  });

  it("未开启 P/A 双模型时忽略阶段配置，直接用 fallback", () => {
    expect(resolvePhaseModel({ ...session, pairMode: false }, "plan", fallback)).toEqual(fallback);
    expect(resolvePhaseModel({ ...session, pairMode: undefined }, "interactive", fallback)).toEqual(fallback);
    // 全局阶段默认同样不参与选模
    expect(
      resolvePhaseModel({ ...session, pairMode: false }, "plan", fallback, {
        planModel: { providerId: "g-plan", modelId: "gm-plan" },
      }),
    ).toEqual(fallback);
  });

  const defaults = {
    planModel: { providerId: "g-plan", modelId: "gm-plan" },
    actModel: { providerId: "g-act", modelId: "gm-act" },
  };

  it("会话阶段覆盖优先于全局阶段默认", () => {
    expect(resolvePhaseModel(session, "plan", fallback, defaults)).toEqual({
      providerId: "p-plan",
      modelId: "m-plan",
    });
    expect(resolvePhaseModel(session, "interactive", fallback, defaults)).toEqual({
      providerId: "p-act",
      modelId: "m-act",
    });
  });

  it("会话未覆盖时走全局阶段默认（plan 取 planModel，其余取 actModel）", () => {
    const bare = { ...session, planModelId: null, actModelId: null };
    expect(resolvePhaseModel(bare, "plan", fallback, defaults)).toEqual({
      providerId: "g-plan",
      modelId: "gm-plan",
    });
    expect(resolvePhaseModel(bare, "interactive", fallback, defaults)).toEqual({
      providerId: "g-act",
      modelId: "gm-act",
    });
    expect(resolvePhaseModel(bare, "autopilot", fallback, defaults)).toEqual({
      providerId: "g-act",
      modelId: "gm-act",
    });
  });

  it("会话与全局默认都没有时回落 fallback", () => {
    const bare = { ...session, planModelId: null, actModelId: null };
    expect(resolvePhaseModel(bare, "plan", fallback, { planModel: null, actModel: null })).toEqual(fallback);
    expect(resolvePhaseModel(bare, "interactive", fallback, {})).toEqual(fallback);
    // 只配了 Act 默认时，Plan 仍回落 fallback
    expect(resolvePhaseModel(bare, "plan", fallback, { actModel: defaults.actModel })).toEqual(fallback);
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

describe("自动两阶段（shouldAutoPlan / 计划注入）", () => {
  const base = {
    pairMode: true,
    mode: "interactive" as const,
    planProviderId: "p-plan",
    planModelId: "m-plan",
    actProviderId: "p-act",
    actModelId: "m-act",
  };

  it("非 plan 模式且计划/执行模型不同才触发", () => {
    expect(shouldAutoPlan(base)).toBe(true);
    expect(shouldAutoPlan({ ...base, mode: "plan" })).toBe(false);
    // 未开启 P/A 双模型：只走单模型，不做自动两阶段
    expect(shouldAutoPlan({ ...base, pairMode: false })).toBe(false);
    // 计划与执行指向同一个供应商 + 同一个模型：无需两阶段
    expect(shouldAutoPlan({ ...base, actProviderId: "p-plan", actModelId: "m-plan" })).toBe(false);
    expect(shouldAutoPlan({ ...base, planModelId: null })).toBe(false);
    expect(shouldAutoPlan({ ...base, background: true })).toBe(false);
    expect(shouldAutoPlan({ ...base, autoPlan: false })).toBe(false);
  });

  it("预规划提示只要求计划，不执行", () => {
    const prompt = buildPlanPrompt("给登录页加个验证码");
    expect(prompt).toContain("给登录页加个验证码");
    expect(prompt).toContain("不要执行任何操作");
    expect(prompt).toContain("不要写代码");
  });

  it("计划注入排在原系统提示之后；空计划不改变提示", () => {
    const merged = appendPlanDirective("基础提示", "1. 读文件\n2. 改组件");
    expect(merged.startsWith("基础提示\n\n")).toBe(true);
    expect(merged).toContain("【预生成计划");
    expect(merged).toContain("2. 改组件");
    expect(appendPlanDirective("基础提示", "   ")).toBe("基础提示");
  });
});
