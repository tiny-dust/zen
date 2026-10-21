import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildApprovalGate, matchApprovalRule, parseReviewerVerdict } from "./approval-gate";
import { completeOnce } from "./model-api";

import type { CommandApprovalRule } from "@zen/shared";

vi.mock("./model-api", () => ({
  completeOnce: vi.fn(),
}));

const completeOnceMock = vi.mocked(completeOnce);

const RULES: CommandApprovalRule[] = [
  { pattern: "git status", decision: "allow" },
  { pattern: "pnpm test", decision: "ask" },
  { pattern: "pnpm", decision: "allow" },
];

describe("matchApprovalRule 前缀匹配", () => {
  it("前缀命中：完整命令与前缀开头的命令都命中", () => {
    expect(matchApprovalRule("git status", RULES)).toBe(RULES[0]);
    expect(matchApprovalRule("git status --short", RULES)).toBe(RULES[0]);
    expect(matchApprovalRule("pnpm install", RULES)).toBe(RULES[2]);
  });

  it("前缀不命中：中间/尾部出现关键词不算", () => {
    expect(matchApprovalRule("echo git status", RULES)).toBeNull();
    expect(matchApprovalRule("my-git status", RULES)).toBeNull();
    expect(matchApprovalRule("git stash", RULES)).toBeNull();
  });

  it("大小写不敏感", () => {
    expect(matchApprovalRule("GIT STATUS", RULES)).toBe(RULES[0]);
    expect(matchApprovalRule("Git Status", RULES)).toBe(RULES[0]);
  });

  it("首尾空白忽略：命令与 pattern 两侧 trim", () => {
    expect(matchApprovalRule("   git status  ", RULES)).toBe(RULES[0]);
    const padded: CommandApprovalRule[] = [{ pattern: "  git status  ", decision: "allow" }];
    expect(matchApprovalRule("git status", padded)).toBe(padded[0]);
  });

  it("多规则优先级：数组顺序首条命中生效，ask 可覆盖后面的宽规则", () => {
    // "pnpm test" 在 "pnpm" 之前：test 命中 ask，不被后面的 allow 覆盖
    expect(matchApprovalRule("pnpm test -- --watch", RULES)).toBe(RULES[1]);
    // 未命中窄规则才落到宽规则
    expect(matchApprovalRule("pnpm lint", RULES)).toBe(RULES[2]);
  });

  it("空命令、空 pattern 与空规则表", () => {
    expect(matchApprovalRule("", RULES)).toBeNull();
    expect(matchApprovalRule("   ", RULES)).toBeNull();
    expect(matchApprovalRule("git status", [])).toBeNull();
    expect(
      matchApprovalRule("git status", [{ pattern: "   ", decision: "allow" }]),
    ).toBeNull();
  });
});

describe("parseReviewerVerdict 审查输出解析", () => {
  it("标准 JSON 与带代码围栏的输出都能解析", () => {
    expect(parseReviewerVerdict('{"approved": true, "reason": "只读命令"}')).toEqual({
      approved: true,
      reason: "只读命令",
    });
    expect(
      parseReviewerVerdict('```json\n{"approved": false, "reason": "会删除文件"}\n```'),
    ).toEqual({ approved: false, reason: "会删除文件" });
  });

  it("杂文包裹与前后说明文字容忍；approved 缺失/非布尔/无 JSON 返回 null", () => {
    expect(parseReviewerVerdict('结论如下：{"approved": true, "reason": "ok"} 完毕')).toEqual({
      approved: true,
      reason: "ok",
    });
    expect(parseReviewerVerdict('{"reason": "ok"}')).toBeNull();
    expect(parseReviewerVerdict('{"approved": "yes"}')).toBeNull();
    expect(parseReviewerVerdict("模型未按格式输出")).toBeNull();
    expect(parseReviewerVerdict('{"approved": true, ')).toBeNull();
  });

  it("reason 非字符串或缺省时回退空串（放行标注仍有兜底文案）", () => {
    expect(parseReviewerVerdict('{"approved": true}')).toEqual({ approved: true, reason: "" });
    expect(parseReviewerVerdict('{"approved": true, "reason": 123}')).toEqual({
      approved: true,
      reason: "",
    });
  });
});

describe("buildApprovalGate 闸流程", () => {
  const request = { toolName: "runTerminal", command: "pnpm test", input: { command: "pnpm test" } };

  beforeEach(() => {
    completeOnceMock.mockReset();
  });

  it("命中 allow 规则直接放行并标注；不走助手模型", async () => {
    const gate = buildApprovalGate({ rules: RULES, reviewer: "off" });
    const verdict = await gate({ ...request, command: "git status" });
    expect(verdict).toEqual({ approved: true, note: '已按命令规则「git status」自动放行' });
    expect(completeOnceMock).not.toHaveBeenCalled();
  });

  it("命中 ask 规则回落人工：不被助手核准覆盖", async () => {
    const gate = buildApprovalGate({ rules: RULES, reviewer: "assistant" });
    const verdict = await gate(request);
    expect(verdict).toBeNull();
    expect(completeOnceMock).not.toHaveBeenCalled();
  });

  it("帮我核准开启：未命中规则时调用当前模型，判定安全则放行并带理由", async () => {
    completeOnceMock.mockResolvedValue('{"approved": true, "reason": "常规测试命令"}');
    const gate = buildApprovalGate({
      rules: [],
      reviewer: "assistant",
      providerId: "prov-1",
      modelId: "model-a",
    });
    const verdict = await gate({ toolName: "runTerminal", command: "npm run build", input: {} });
    expect(verdict).toEqual({ approved: true, note: "已由助手模型核准：常规测试命令" });
    expect(completeOnce).toHaveBeenCalledWith(expect.any(String), {
      system: expect.any(String),
      timeoutMs: 15_000,
      maxTokens: expect.any(Number),
      providerId: "prov-1",
      modelId: "model-a",
    });
  });

  it("帮我核准失败回退人工：模型判否 / 抛错（超时）/ 输出不可解析均为 null", async () => {
    const gate = buildApprovalGate({ rules: [], reviewer: "assistant" });

    completeOnceMock.mockResolvedValueOnce('{"approved": false, "reason": "有风险"}');
    expect(await gate(request)).toBeNull();

    completeOnceMock.mockRejectedValueOnce(new Error("请求超时"));
    expect(await gate(request)).toBeNull();

    completeOnceMock.mockResolvedValueOnce("我认为这个命令没有问题");
    expect(await gate(request)).toBeNull();
  });

  it("帮我核准关闭：未命中规则直接回落人工，不调模型", async () => {
    const gate = buildApprovalGate({ rules: [], reviewer: "off" });
    expect(await gate(request)).toBeNull();
    expect(completeOnceMock).not.toHaveBeenCalled();
  });

  it("无 command 的工具（非命令类）不参与规则匹配，仅走助手核准", async () => {
    completeOnceMock.mockResolvedValue('{"approved": true, "reason": "工作区内写文件"}');
    const gate = buildApprovalGate({ rules: RULES, reviewer: "assistant" });
    const verdict = await gate({ toolName: "writeFile", input: { path: "a.txt" } });
    expect(verdict).toEqual({ approved: true, note: "已由助手模型核准：工作区内写文件" });
    // 规则表只对命令生效：writeFile 不可能命中 "pnpm" 前缀
    const offGate = buildApprovalGate({ rules: RULES, reviewer: "off" });
    expect(await offGate({ toolName: "writeFile", input: {} })).toBeNull();
  });
});
