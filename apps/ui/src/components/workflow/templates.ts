import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./graph";

/**
 * 默认工作流模板：只使用当前可以保存与运行的节点（开始 / 模型 / 条件 / 循环 / 审批 / 结束），
 * 工具、脚本、HTTP 节点执行能力尚未开放，因此不进入任何模板。
 * 选择模板只在编辑器里生成草稿，不会保存或运行。
 */

export type WorkflowTemplateId = "basic" | "branch" | "full";

interface TemplateNode {
  id: string;
  type: WorkflowNodeType;
  x: number;
  y: number;
  /** 显示名 i18n key 后缀（workflow.templateNode.*）；缺省用节点类型名 */
  labelKey?: string;
  /** 模型指令（同一个模型的文本由 buildTemplateGraph 统一注入） */
  instructions?: string;
  maxIterations?: number;
  left?: string;
  right?: string;
}

interface TemplateEdge {
  from: string;
  to: string;
  type: WorkflowEdge["type"];
}

interface TemplateSpec {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

const TEMPLATES: Record<WorkflowTemplateId, TemplateSpec> = {
  // 最简链路：开始 → 模型 → 结束
  basic: {
    nodes: [
      { id: "start", type: "start", x: 40, y: 60 },
      { id: "answer", type: "model", x: 300, y: 60, labelKey: "answer", instructions: "阅读用户请求，必要时先用只读工具了解工作区，然后给出结果。" },
      { id: "end", type: "end", x: 560, y: 60 },
    ],
    edges: [
      { from: "start", to: "answer", type: "next" },
      { from: "answer", to: "end", type: "next" },
    ],
  },
  // 条件分支 + 人工审批：区分「可以执行」与「暂不执行」两条路
  branch: {
    nodes: [
      { id: "start", type: "start", x: 40, y: 120 },
      { id: "plan", type: "model", x: 300, y: 120, labelKey: "plan", instructions: "分析需求并给出实现要点；只做只读探查，不修改文件。" },
      { id: "decide", type: "condition", x: 560, y: 120, left: "$plan", right: "可以执行" },
      { id: "implement", type: "model", x: 820, y: 40, labelKey: "implement", instructions: "按方案完成实现，改动前确认必要的审批。" },
      { id: "review", type: "approval", x: 1080, y: 40, labelKey: "review" },
      { id: "done", type: "end", x: 1340, y: 40, labelKey: "done" },
      { id: "stop", type: "end", x: 820, y: 220, labelKey: "stop" },
    ],
    edges: [
      { from: "start", to: "plan", type: "next" },
      { from: "plan", to: "decide", type: "next" },
      { from: "decide", to: "implement", type: "true" },
      { from: "decide", to: "stop", type: "false" },
      { from: "implement", to: "review", type: "next" },
      { from: "review", to: "done", type: "approved" },
      { from: "review", to: "stop", type: "denied" },
    ],
  },
  // 全量能力：模型 + 条件分支 + 循环 + 审批 + 两种结束
  full: {
    nodes: [
      { id: "start", type: "start", x: 40, y: 140 },
      { id: "plan", type: "model", x: 300, y: 140, labelKey: "plan", instructions: "拆解任务为有序步骤，标注步骤涉及的文件、命令与风险。" },
      { id: "decide", type: "condition", x: 560, y: 140, left: "$plan", right: "可以执行" },
      { id: "build", type: "model", x: 820, y: 60, labelKey: "build", instructions: "实现当前步骤的改动。" },
      { id: "loop", type: "loop", x: 1080, y: 60, maxIterations: 5 },
      { id: "verify", type: "model", x: 1340, y: 60, labelKey: "verify", instructions: "复查当前结果（读取文件或运行必要命令），确认是否达到完成条件。" },
      { id: "review", type: "approval", x: 1600, y: 60, labelKey: "review" },
      { id: "done", type: "end", x: 1860, y: 60, labelKey: "done" },
      { id: "stop", type: "end", x: 1080, y: 260, labelKey: "stop" },
    ],
    edges: [
      { from: "start", to: "plan", type: "next" },
      { from: "plan", to: "decide", type: "next" },
      { from: "decide", to: "build", type: "true" },
      { from: "decide", to: "stop", type: "false" },
      { from: "build", to: "loop", type: "next" },
      { from: "loop", to: "verify", type: "body" },
      { from: "loop", to: "review", type: "exit" },
      { from: "verify", to: "loop", type: "next" },
      { from: "review", to: "done", type: "approved" },
      { from: "review", to: "stop", type: "denied" },
    ],
  },
};

export const WORKFLOW_TEMPLATE_IDS: readonly WorkflowTemplateId[] = ["basic", "branch", "full"];

export interface TemplateModel {
  providerId: string;
  modelId: string;
}

/**
 * 生成模板图谱：模型节点统一套用传入的默认模型（未启用任何模型时留空，
 * 由编辑器校验提示用户选择），显示名通过 translate 取当前语言。
 */
export function buildTemplateGraph(
  templateId: WorkflowTemplateId,
  options: { model?: TemplateModel; translate: (key: string) => string },
): WorkflowGraph {
  const spec = TEMPLATES[templateId];
  const nodes: WorkflowNode[] = spec.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: node.labelKey ? options.translate(`workflow.templateNode.${node.labelKey}`) : node.type,
    x: node.x,
    y: node.y,
    settings: {
      ...(node.type === "model"
        ? {
            ...(options.model ? { providerId: options.model.providerId, modelId: options.model.modelId } : {}),
            instructions: node.instructions,
          }
        : {}),
      ...(node.type === "condition"
        ? { left: node.left, right: node.right, operator: "equals" as const }
        : {}),
      ...(node.type === "loop" && node.maxIterations !== undefined
        ? { maxIterations: node.maxIterations }
        : {}),
    },
  }));
  return {
    nodes,
    edges: spec.edges.map((edge, index) => ({
      id: `edge-${index + 1}`,
      source: edge.from,
      target: edge.to,
      type: edge.type,
    })),
    budgets: { maxSteps: 100, maxEffects: 10 },
  };
}
