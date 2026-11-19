import { describe, expect, it } from "vitest";
import { canConnect, edgeTypesFor, moveNode, removeNode, toRuntimeWorkflow } from "./graph";
import type { WorkflowGraph, WorkflowNodeType } from "./graph";

const node = (id: string, type: WorkflowNodeType, settings: WorkflowGraph["nodes"][number]["settings"] = {}) =>
  ({ id, type, label: id, x: 0, y: 0, settings });
const graph: WorkflowGraph = {
  budgets: { maxSteps: 20, maxEffects: 5 },
  nodes: [node("start", "start"), node("condition", "condition", { left: "$model", right: "ready", operator: "equals" }), node("end", "end")],
  edges: [
    { id: "s", source: "start", target: "condition", type: "next" },
    { id: "t", source: "condition", target: "end", type: "true" },
    { id: "f", source: "condition", target: "end", type: "false" },
  ],
};

describe("workflow graph operations", () => {
  it("uses runtime labels, allowing distinct branches to the same target but only one edge per outcome", () => {
    expect(edgeTypesFor("condition")).toEqual(["true", "false"]);
    expect(edgeTypesFor("loop")).toEqual(["body", "exit"]);
    expect(edgeTypesFor("approval")).toEqual(["approved", "denied"]);
    expect(canConnect(graph, "condition", "end", "true")).toBe(false);
    expect(canConnect(graph, "condition", "condition", "body")).toBe(false);
    expect(canConnect(graph, "end", "condition", "next")).toBe(false);
    expect(canConnect({ ...graph, edges: graph.edges.slice(0, 2) }, "condition", "end", "false")).toBe(true);
    expect(canConnect(graph, "condition", "start", "false")).toBe(false);
  });

  it("converts all branches and budgets to the runtime contract without losing settings", () => {
    const result = toRuntimeWorkflow(graph);
    expect(result.graph.edges).toEqual([
      { from: "start", to: "condition", label: "next" },
      { from: "condition", to: "end", label: "true" },
      { from: "condition", to: "end", label: "false" },
    ]);
    expect(result.budgets).toEqual({ maxSteps: 20, maxEffects: 5 });
    expect(result.nodeSettings.condition).toEqual({ left: "$model", right: "ready", operator: "equals" });
    expect(() => toRuntimeWorkflow({ ...graph, edges: graph.edges.slice(0, 2) })).toThrow("Missing or duplicate edge");
    expect(() => toRuntimeWorkflow({ ...graph, budgets: { maxSteps: 0, maxEffects: 5 } })).toThrow("Invalid run budgets");
  });

  it("maps supported effects conservatively and rejects unsupported execution", () => {
    const types = ["model", "approval"] as const;
    for (const type of types) {
      const settings = { providerId: "p", modelId: "m", instructions: "ask" };
      const data: WorkflowGraph = {
        budgets: { maxSteps: 10, maxEffects: 2 },
        nodes: [node("start", "start"), node("effect", type, settings), node("end", "end")],
        edges: [
          { id: "s", source: "start", target: "effect", type: "next" },
          { id: "e", source: "effect", target: "end", type: type === "approval" ? "approved" : "next" },
          ...(type === "approval" ? [{ id: "d", source: "effect", target: "end", type: "denied" as const }] : []),
        ],
      };
      const runtime = toRuntimeWorkflow(data);
      expect(runtime.graph.nodes[1]).toMatchObject({ id: "effect", type, idempotent: false });
      expect(runtime.graph.edges.length).toBe(type === "approval" ? 3 : 2);
    }
    const loop: WorkflowGraph = {
      budgets: { maxSteps: 10, maxEffects: 0 },
      nodes: [node("start", "start"), node("loop", "loop", { maxIterations: 2 }), node("end", "end")],
      edges: [
        { id: "s", source: "start", target: "loop", type: "next" },
        { id: "b", source: "loop", target: "loop", type: "body" },
        { id: "e", source: "loop", target: "end", type: "exit" },
      ],
    };
    const converted = toRuntimeWorkflow(loop);
    expect(converted.graph.nodes[1]).toEqual({ id: "loop", type: "loop", maxIterations: 2 });
    expect(converted.graph.edges.map((edge) => edge.label)).toEqual(["next", "body", "exit"]);
    expect(toRuntimeWorkflow({ ...loop, nodes: loop.nodes.map((item) => item.id === "loop" ? node("loop", "loop") : item) }).graph.nodes[1]).toEqual({ id: "loop", type: "loop" });
    for (const type of ["tool", "script", "http"] as const) {
      expect(() => toRuntimeWorkflow({ ...loop, nodes: [loop.nodes[0]!, node("loop", type), loop.nodes[2]!] })).toThrow("execution is disabled");
    }
    expect(() => toRuntimeWorkflow({ ...graph, nodes: graph.nodes.map((item) => item.type === "condition" ? node(item.id, item.type, { expression: "true" }) : item) })).toThrow("Condition needs left, right and operator");
    expect(() => toRuntimeWorkflow({ ...graph, nodes: graph.nodes.map((item) => item.type === "condition" ? node(item.id, item.type, { left: "", right: "", operator: "equals" }) : item) })).not.toThrow();
  });

  it("removes attached connections and reorders without mutating input", () => {
    expect(removeNode(graph, "condition")).toEqual({ budgets: graph.budgets, nodes: [graph.nodes[0], graph.nodes[2]], edges: [] });
    expect(moveNode(graph, "condition", -1).nodes.map((item) => item.id)).toEqual(["condition", "start", "end"]);
    expect(moveNode(graph, "start", -1)).toBe(graph);
  });
});
