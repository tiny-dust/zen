import { describe, expect, it } from "vitest";

import { routeModel } from "./model-routing";

import type { ModelRoutingCandidate } from "./model-routing";

function candidate(
  providerId: string,
  modelId: string,
  capabilities?: ModelRoutingCandidate["capabilities"],
  name?: string,
): ModelRoutingCandidate {
  return { providerId, modelId, capabilities, name };
}

/** 典型候选集：轻量 flash / 重推理 pro / 普通标准模型 */
const POOL: ModelRoutingCandidate[] = [
  candidate("p1", "vendor/chat-flash", { toolCall: true, contextWindow: 32_000 }),
  candidate("p1", "vendor/thinker-pro", {
    toolCall: true,
    reasoning: true,
    contextWindow: 200_000,
  }),
  candidate("p2", "vendor/standard", { toolCall: true, contextWindow: 64_000 }),
  candidate("p2", "vendor/vision-pro", {
    toolCall: true,
    reasoning: true,
    vision: true,
    contextWindow: 128_000,
  }),
];

describe("routeModel", () => {
  it("无候选返回 null", () => {
    expect(routeModel([], { text: "你好" })).toBeNull();
  });

  it("带图片 → 必须路由到支持视觉的模型", () => {
    const decision = routeModel(POOL, { text: "看下这张图", hasImages: true, needsTools: true });
    expect(decision).not.toBeNull();
    expect(decision?.modelId).toBe("vendor/vision-pro");
    expect(decision?.rules).toContain("image-vision");
  });

  it("带图片但无视觉模型 → 回退全量并记 fallback", () => {
    const noVision = POOL.filter((item) => item.modelId !== "vendor/vision-pro");
    const decision = routeModel(noVision, { text: "看下这张图", hasImages: true });
    expect(decision).not.toBeNull();
    expect(decision?.rules).toContain("image-vision");
    expect(decision?.rules).toContain("fallback");
    // 回退后无加分规则：按原顺序取第一个
    expect(decision?.modelId).toBe("vendor/chat-flash");
  });

  it("重构/调试/架构类关键词 → 优先推理模型", () => {
    const decision = routeModel(POOL, {
      text: "帮我重构这段代码并排查性能问题，输出架构分析",
      needsTools: true,
    });
    expect(decision?.modelId).toBe("vendor/thinker-pro");
    expect(decision?.rules).toContain("reasoning-task");
    expect(decision?.rules).not.toContain("casual-light");
  });

  it("上下文超长 → 优先推理 + 大上下文模型", () => {
    const decision = routeModel(POOL, {
      text: "继续",
      needsTools: true,
      estimatedTokens: 150_000,
    });
    expect(decision?.modelId).toBe("vendor/thinker-pro");
    expect(decision?.rules).toContain("long-context");
  });

  it("简短日常问答 → 优先轻量快速模型", () => {
    const decision = routeModel(POOL, { text: "今天天气怎么样", needsTools: true });
    expect(decision?.modelId).toBe("vendor/chat-flash");
    expect(decision?.rules).toContain("casual-light");
  });

  it("轻量判定覆盖 name 中的关键词（如 hemisphere）", () => {
    const pool = [
      candidate("p1", "vendor/big-model", { toolCall: true, reasoning: true }, "大杯推理"),
      candidate("p2", "vendor/x", { toolCall: true }, "Hemisphere Lite"),
    ];
    const decision = routeModel(pool, { text: "hi", needsTools: true });
    expect(decision?.modelId).toBe("vendor/x");
    expect(decision?.rules).toContain("casual-light");
  });

  it("需要工具 → 排除未启用 toolCall 的模型", () => {
    const pool = [
      candidate("p1", "vendor/no-tools", { reasoning: true }),
      candidate("p2", "vendor/with-tools", { toolCall: true }),
    ];
    const decision = routeModel(pool, { text: "帮我执行一些操作", needsTools: true });
    expect(decision?.modelId).toBe("vendor/with-tools");
    expect(decision?.rules).toContain("tools");
  });

  it("长文本无关键词 → 不按轻量路由，按原顺序稳定输出", () => {
    const longText =
      "这是一段比较长的描述，不包含任何触发关键词，只是详细说明需求的背景信息、约束条件、期望产出与验收标准，" +
      "同时补充若干与主旨无关但会显著拉长正文的细节，确保总长度超过简短问答的字符阈值，" +
      "用于验证该场景不会被误判为轻量任务，也不触发推理类关键词。再补一句占位。";
    expect(longText.trim().length).toBeGreaterThan(120);
    const decision = routeModel(POOL, { text: longText, needsTools: true });
    // 无加分规则（fallback）时保持列表原顺序
    expect(decision?.modelId).toBe("vendor/chat-flash");
    expect(decision?.rules).toEqual(["tools", "fallback"]);
  });

  it("硬性过滤交叉：图片 + 工具，仅视觉且带工具的模型入选", () => {
    const pool = [
      candidate("p1", "vendor/vision-no-tools", { vision: true }),
      candidate("p2", "vendor/tools-no-vision", { toolCall: true }),
      candidate("p3", "vendor/vision-tools", { vision: true, toolCall: true }),
    ];
    const decision = routeModel(pool, { text: "看图并处理", hasImages: true, needsTools: true });
    expect(decision?.modelId).toBe("vendor/vision-tools");
  });

  it("得分并列时保持候选列表原顺序（稳定）", () => {
    const pool = [
      candidate("p1", "vendor/a", { toolCall: true }),
      candidate("p2", "vendor/b", { toolCall: true }),
    ];
    const first = routeModel(pool, { text: "随便看看", needsTools: true });
    const second = routeModel([...pool].reverse(), { text: "随便看看", needsTools: true });
    expect(first?.modelId).toBe("vendor/a");
    expect(second?.modelId).toBe("vendor/b");
  });
});
