import { describe, expect, it, vi } from "vitest";

import { runWorkflow, validateWorkflow, workflowEffectKey } from "./workflow";

import type { WorkflowAdapters, WorkflowEvent, WorkflowGraph, WorkflowJournal } from "./workflow";

function journal(initial: WorkflowEvent[] = []): WorkflowJournal & { events: WorkflowEvent[] } {
  const events = [...initial];
  return { events, load: async () => [...events], append: async (event) => { events.push(event); } };
}

function adapters(): WorkflowAdapters {
  return {
    execute: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => true),
    evaluateCondition: vi.fn(async () => true),
    shouldContinue: vi.fn(async () => true),
  };
}

const linear: WorkflowGraph = {
  nodes: [{ id: "start", type: "start" }, { id: "tool", type: "tool", idempotent: false }, { id: "end", type: "end" }],
  edges: [{ from: "start", to: "tool", label: "next" }, { from: "tool", to: "end", label: "next" }],
};
const budgets = { maxSteps: 20, maxEffects: 10 };

function run(graph: WorkflowGraph, store = journal(), adapter = adapters(), signal?: AbortSignal) {
  return runWorkflow({ graph, runId: "run-1", budgets, journal: store, adapters: adapter, signal });
}

describe("workflow graph and runtime", () => {
  it("validates endpoint, labels, reachability, and an exit path", () => {
    expect(() => validateWorkflow(linear)).not.toThrow();
    expect(() => validateWorkflow({ ...linear, edges: linear.edges.slice(0, 1) })).toThrow("Missing edge");
    expect(() => validateWorkflow({ ...linear, edges: [{ from: "start", to: "missing", label: "next" }, { from: "tool", to: "end", label: "next" }] })).toThrow("Dangling edge");
    expect(() => validateWorkflow({ ...linear, nodes: [...linear.nodes, { id: "orphan", type: "end" }] })).toThrow("Unreachable");
    expect(() => validateWorkflow({ nodes: [{ id: "start", type: "start" }, { id: "loop", type: "loop" }, { id: "end", type: "end" }], edges: [
      { from: "start", to: "loop", label: "next" }, { from: "loop", to: "loop", label: "body" }, { from: "loop", to: "loop", label: "exit" },
    ] })).toThrow("Unreachable");
  });

  it("journals before/after effects, replays completed runs without repeating effects", async () => {
    const store = journal();
    const adapter = adapters();
    expect((await run(linear, store, adapter)).status).toBe("completed");
    expect(store.events.map((event) => event.type)).toEqual(["transition", "before", "after", "transition"]);
    expect(store.events[1]).toMatchObject({ nodeId: "tool", key: workflowEffectKey("run-1", 1, "tool") });
    expect((await run(linear, store, adapter)).status).toBe("completed");
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("holds uncertain non-idempotent effects for review, including adapter failures", async () => {
    const store = journal();
    const adapter = adapters();
    adapter.execute = vi.fn(async () => { throw new Error("unknown outcome"); });
    expect((await run(linear, store, adapter)).status).toBe("pending-review");
    expect((await run(linear, store, adapter)).status).toBe("pending-review");
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(store.events.map((event) => event.type)).toEqual(["transition", "before"]);
  });

  it("retries pending idempotent effects with the same key; skips committed after events", async () => {
    const graph: WorkflowGraph = { ...linear, nodes: linear.nodes.map((node) => node.type === "tool" ? { ...node, idempotent: true } : node) };
    const store = journal();
    const adapter = adapters();
    adapter.execute = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    expect((await run(graph, store, adapter)).status).toBe("failed");
    expect((await run(graph, store, adapter)).status).toBe("completed");
    expect(adapter.execute).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adapter.execute).mock.calls[0]?.[1].key).toBe(vi.mocked(adapter.execute).mock.calls[1]?.[1].key);
    const interrupted = journal(store.events.slice(0, -1));
    await run(graph, interrupted, adapter);
    expect(adapter.execute).toHaveBeenCalledTimes(2);
  });

  it("bounds optional unlimited loops by per-run steps and effect counts", async () => {
    const graph: WorkflowGraph = { nodes: [
      { id: "start", type: "start" }, { id: "loop", type: "loop" }, { id: "http", type: "http", idempotent: true }, { id: "end", type: "end" },
    ], edges: [
      { from: "start", to: "loop", label: "next" }, { from: "loop", to: "http", label: "body" },
      { from: "loop", to: "end", label: "exit" }, { from: "http", to: "loop", label: "next" },
    ] };
    const adapter = adapters();
    const store = journal();
    const result = await runWorkflow({ graph, runId: "loop", budgets: { maxSteps: 100, maxEffects: 2 }, journal: store, adapters: adapter });
    expect(result).toMatchObject({ status: "budget-exhausted", effects: 2, nodeId: "http" });
    expect(adapter.execute).toHaveBeenCalledTimes(2);
    expect((await runWorkflow({ graph, runId: "loop", budgets: { maxSteps: 100, maxEffects: 2 }, journal: store, adapters: adapter })).status).toBe("budget-exhausted");
    expect((await runWorkflow({ graph, runId: "steps", budgets: { maxSteps: 3, maxEffects: 100 }, journal: journal(), adapters: adapter })).status).toBe("budget-exhausted");
  });

  it("branches deterministically and enforces local loop iteration cap", async () => {
    const graph: WorkflowGraph = { nodes: [
      { id: "start", type: "start" }, { id: "condition", type: "condition" }, { id: "loop", type: "loop", maxIterations: 1 },
      { id: "approval", type: "approval", idempotent: false }, { id: "end", type: "end" },
    ], edges: [
      { from: "start", to: "condition", label: "next" }, { from: "condition", to: "loop", label: "true" },
      { from: "condition", to: "end", label: "false" }, { from: "loop", to: "approval", label: "body" },
      { from: "loop", to: "end", label: "exit" }, { from: "approval", to: "loop", label: "approved" },
      { from: "approval", to: "end", label: "denied" },
    ] };
    const adapter = adapters();
    const store = journal();
    expect((await run(graph, store, adapter)).status).toBe("completed");
    expect(adapter.shouldContinue).toHaveBeenCalledTimes(1);
    expect(adapter.requestApproval).toHaveBeenCalledTimes(1);
    expect(store.events.filter((event) => event.type === "transition").map((event) => event.outcome)).toEqual(["next", "true", "body", "approved", "exit"]);
  });

  it("cancels after a committed effect without starting the next one", async () => {
    const controller = new AbortController();
    const graph: WorkflowGraph = {
      nodes: [{ id: "start", type: "start" }, { id: "first", type: "model", idempotent: true }, { id: "second", type: "http", idempotent: true }, { id: "end", type: "end" }],
      edges: [{ from: "start", to: "first", label: "next" }, { from: "first", to: "second", label: "next" }, { from: "second", to: "end", label: "next" }],
    };
    const adapter = adapters();
    adapter.execute = vi.fn(async () => { controller.abort(); });
    const store = journal();
    expect(await run(graph, store, adapter, controller.signal)).toMatchObject({ status: "cancelled", nodeId: "second", effects: 1 });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(store.events.map((event) => event.type)).toEqual(["transition", "before", "after", "transition"]);
  });

  it("cancels before starting another effect and does not execute scripts or HTTP internally", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = adapters();
    expect((await run(linear, journal(), adapter, controller.signal)).status).toBe("cancelled");
    expect(adapter.execute).not.toHaveBeenCalled();
    const graph: WorkflowGraph = { ...linear, nodes: linear.nodes.map((node) => node.type === "tool" ? { ...node, type: "script" } : node) };
    await run(graph, journal(), adapter);
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "script" }), expect.any(Object));
  });
});
