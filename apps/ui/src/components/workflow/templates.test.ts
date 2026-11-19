import { describe, expect, it } from "vitest";

import { toRuntimeWorkflow } from "./graph";
import { buildTemplateGraph, WORKFLOW_TEMPLATE_IDS } from "./templates";

const model = { providerId: "provider-a", modelId: "model-a" };
const translate = (key: string) => key;

describe("默认工作流模板", () => {
  it.each(WORKFLOW_TEMPLATE_IDS)("%s 只用可运行节点，选中模型后即可保存", (template) => {
    const graph = buildTemplateGraph(template, { model, translate });
    expect(() => toRuntimeWorkflow(graph)).not.toThrow();
    // 工具、脚本、HTTP 节点当前不能保存或运行，模板里不得出现
    expect(graph.nodes.some((node) => ["tool", "script", "http"].includes(node.type))).toBe(false);
  });

  it("基础模板是最小链路：开始 → 模型 → 结束", () => {
    const graph = buildTemplateGraph("basic", { model, translate });
    expect(graph.nodes.map((node) => node.type)).toEqual(["start", "model", "end"]);
    expect(graph.edges.map((edge) => edge.type)).toEqual(["next", "next"]);
  });

  it("进阶模板带条件分支与人工审批", () => {
    const graph = buildTemplateGraph("branch", { model, translate });
    expect(graph.nodes.some((node) => node.type === "condition")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "approval")).toBe(true);
    expect(graph.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(["true", "false", "approved", "denied"]),
    );
  });

  it("完整模板覆盖条件、循环、审批与两种结束方式", () => {
    const graph = buildTemplateGraph("full", { model, translate });
    const types = new Set(graph.nodes.map((node) => node.type));
    for (const type of ["start", "model", "condition", "loop", "approval", "end"] as const) {
      expect(types.has(type)).toBe(true);
    }
    expect(graph.nodes.filter((node) => node.type === "end")).toHaveLength(2);
    expect(graph.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(["body", "exit", "approved", "denied", "true", "false"]),
    );
  });

  it("未启用模型时留空，校验提示选择模型", () => {
    const graph = buildTemplateGraph("basic", { translate });
    expect(() => toRuntimeWorkflow(graph)).toThrow(/Select a provider and model/);
  });
});
