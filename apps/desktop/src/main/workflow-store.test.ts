import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runWorkflow, workflowEffectKey } from "@zen/agent-core";

const db = new Database(":memory:");
vi.mock("./model-db-connection", () => ({ getDb: () => db }));

import {
  appendWorkflowEvent, commitPersistedModelOutput, createWorkflowRun, getWorkflowRun, openWorkflow, parseSnapshot, skipUncertainModel,
  recordApproval, recordWorkflowOutput, recoverWorkflowRuns, resolveWorkflowValue, saveWorkflow, listWorkflows, listWorkflowRuns, updateWorkflowRun, workflowJournal,
} from "./workflow-store";

const approval = {
  graph: {
    nodes: [{ id: "start", type: "start" }, { id: "review", type: "approval", idempotent: false }, { id: "end", type: "end" }],
    edges: [
      { from: "start", to: "review", label: "next" },
      { from: "review", to: "end", label: "approved" },
      { from: "review", to: "end", label: "denied" },
    ],
  },
  nodeSettings: {},
  budgets: { maxSteps: 10, maxEffects: 3, maxWallMs: 60_000 },
};

beforeAll(() => {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE workflow_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, current_version INTEGER NOT NULL, created_at INTEGER NOT NULL, owner_session_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE workflow_versions (workflow_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (workflow_id, version), FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id));
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version INTEGER NOT NULL, session_id TEXT NOT NULL,
      status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (workflow_id, version) REFERENCES workflow_versions(workflow_id, version));
    CREATE TABLE workflow_journal (run_id TEXT NOT NULL, seq INTEGER NOT NULL, step INTEGER NOT NULL, type TEXT NOT NULL, key TEXT,
      event_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (run_id, seq), UNIQUE (run_id, step, type), UNIQUE (key, type),
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id));
    CREATE TABLE workflow_outputs (key TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, output TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id));
  `);
});
afterAll(() => db.close());

describe("workflow persistence", () => {
  it("rejects unsafe effects and invalid budgets, but accepts bounded loops without a local limit", () => {
    expect(() => parseSnapshot({ ...approval, graph: { ...approval.graph, nodes: [{ id: "start", type: "start" }, { id: "review", type: "tool", idempotent: false }, { id: "end", type: "end" }] } })).toThrow(/disabled/);
    expect(() => parseSnapshot({ ...approval, budgets: { ...approval.budgets, maxWallMs: Infinity } })).toThrow(/budgets/);
    for (const type of ["script", "http"] as const) {
      expect(() => parseSnapshot({ ...approval, graph: { ...approval.graph, nodes: [{ id: "start", type: "start" }, { id: "review", type, idempotent: false }, { id: "end", type: "end" }] } })).toThrow(/disabled/);
    }
    const condition = { graph: { nodes: [{ id: "start", type: "start" }, { id: "check", type: "condition" }, { id: "end", type: "end" }],
      edges: [{ from: "start", to: "check", label: "next" }, { from: "check", to: "end", label: "true" }, { from: "check", to: "end", label: "false" }] },
      nodeSettings: { check: { expression: "true" } }, budgets: approval.budgets };
    expect(() => parseSnapshot(condition)).toThrow(/expression is disabled/);
    const loopGraph = { nodes: [{ id: "start", type: "start" }, { id: "loop", type: "loop" }, { id: "end", type: "end" }],
      edges: [{ from: "start", to: "loop", label: "next" }, { from: "loop", to: "loop", label: "body" }, { from: "loop", to: "end", label: "exit" }] };
    expect(parseSnapshot({ ...approval, graph: loopGraph }).graph.nodes[1]).toMatchObject({ type: "loop" });
    expect(() => parseSnapshot({ ...approval, graph: { ...loopGraph, nodes: [loopGraph.nodes[0], { id: "loop", type: "loop", maxIterations: -1 }, loopGraph.nodes[2]] } })).toThrow(/maxIterations/);
  });

  it("keeps immutable versions and binds each run to its original snapshot", () => {
    const saved = saveWorkflow("one", approval, "session-1");
    const run = createWorkflowRun(saved.id, "session-1");
    const changed = { ...approval, budgets: { ...approval.budgets, maxSteps: 4 } };
    expect(saveWorkflow("two", changed, "session-1", saved.id)).toEqual({ id: saved.id, version: 2 });
    expect(openWorkflow(saved.id, "session-1", 1)?.snapshot.budgets.maxSteps).toBe(10);
    expect(getWorkflowRun(run.id)?.version).toBe(1);
    expect(getWorkflowRun(run.id)?.snapshot.budgets.maxSteps).toBe(10);
  });

  it("isolates definitions and runs by owning session", () => {
    const owned = saveWorkflow("private", approval, "session-owner");
    expect(listWorkflows("session-other")).toEqual([]);
    expect(openWorkflow(owned.id, "session-other")).toBeNull();
    expect(() => saveWorkflow("takeover", approval, "session-other", owned.id)).toThrow(/not found/);
    expect(() => createWorkflowRun(owned.id, "session-other")).toThrow(/not found/);
    expect(listWorkflows("session-owner")).toEqual(expect.arrayContaining([expect.objectContaining({ id: owned.id })]));
    const run = createWorkflowRun(owned.id, "session-owner");
    expect(getWorkflowRun(run.id)?.session_id).toBe("session-owner");
  });

  it("records model output against a pending key and resolves it for conditions", () => {
    const model = {
      graph: { nodes: [{ id: "start", type: "start" }, { id: "generate", type: "model", idempotent: false }, { id: "end", type: "end" }],
        edges: [{ from: "start", to: "generate", label: "next" }, { from: "generate", to: "end", label: "next" }] },
      nodeSettings: { generate: { prompt: "answer", providerId: "provider-a", modelId: "model-a" } }, budgets: approval.budgets,
    };
    expect(() => parseSnapshot({ ...model, nodeSettings: { generate: { prompt: "answer" } } })).toThrow(/provider and model/);
    expect(() => parseSnapshot({ ...model, nodeSettings: { generate: { prompt: "answer", providerId: "provider-a" } } })).toThrow(/provider and model/);
    const saved = saveWorkflow("model", model, "session-model");
    const { id } = createWorkflowRun(saved.id, "session-model");
    appendWorkflowEvent({ type: "transition", runId: id, step: 0, nodeId: "start", nextId: "generate", outcome: "next" });
    const key = workflowEffectKey(id, 1, "generate");
    appendWorkflowEvent({ type: "before", runId: id, step: 1, nodeId: "generate", key });
    recordWorkflowOutput(id, key, "generate", "yes");
    expect(resolveWorkflowValue(id, "$generate")).toBe("yes");
    expect(resolveWorkflowValue(id, "literal")).toBe("literal");
    expect(() => recordWorkflowOutput(id, key, "generate", "duplicate")).toThrow();
    expect(getWorkflowRun(id)?.outputs).toMatchObject([{ key, output: "yes" }]);
    updateWorkflowRun(id, "pending-review");
    expect(() => recordApproval(id, true)).toThrow(/Only approval/);
    expect(commitPersistedModelOutput(id)).toBe(true);
    expect(getWorkflowRun(id)?.journal.at(-1)).toMatchObject({ type: "after", key, outcome: "next" });
    expect(commitPersistedModelOutput(id)).toBe(false);
    expect(() => skipUncertainModel(id)).toThrow(/No uncertain/);
  });

  it("resumes a committed model output without calling the model again", async () => {
    const model = { graph: { nodes: [{ id: "start", type: "start" }, { id: "generate", type: "model", idempotent: false }, { id: "end", type: "end" }],
      edges: [{ from: "start", to: "generate", label: "next" }, { from: "generate", to: "end", label: "next" }] },
      nodeSettings: { generate: { instructions: "answer", providerId: "provider-a", modelId: "model-a" } }, budgets: approval.budgets };
    const { id } = createWorkflowRun(saveWorkflow("replay", model, "session-replay").id, "session-replay");
    appendWorkflowEvent({ type: "transition", runId: id, step: 0, nodeId: "start", nextId: "generate", outcome: "next" });
    const key = workflowEffectKey(id, 1, "generate");
    appendWorkflowEvent({ type: "before", runId: id, step: 1, nodeId: "generate", key });
    recordWorkflowOutput(id, key, "generate", "saved");
    recoverWorkflowRuns();
    expect(commitPersistedModelOutput(id)).toBe(true);
    updateWorkflowRun(id, "running");
    const execute = vi.fn();
    const result = await runWorkflow({ graph: getWorkflowRun(id)!.snapshot.graph, runId: id, budgets: approval.budgets, journal: workflowJournal,
      adapters: { execute, requestApproval: vi.fn(), evaluateCondition: vi.fn(), shouldContinue: vi.fn() } });
    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not replay unknown model effects without a review decision", () => {
    const model = { graph: { nodes: [{ id: "start", type: "start" }, { id: "generate", type: "model", idempotent: false }, { id: "end", type: "end" }],
      edges: [{ from: "start", to: "generate", label: "next" }, { from: "generate", to: "end", label: "next" }] },
      nodeSettings: { generate: { instructions: "answer", providerId: "provider-a", modelId: "model-a" } }, budgets: { maxSteps: 5, maxEffects: 1 } };
    expect(parseSnapshot(model).budgets.maxWallMs).toBe(300_000);
    const { id } = createWorkflowRun(saveWorkflow("unknown", model, "session-unknown").id, "session-unknown");
    appendWorkflowEvent({ type: "transition", runId: id, step: 0, nodeId: "start", nextId: "generate", outcome: "next" });
    const key = workflowEffectKey(id, 1, "generate");
    appendWorkflowEvent({ type: "before", runId: id, step: 1, nodeId: "generate", key });
    updateWorkflowRun(id, "pending-review");
    expect(commitPersistedModelOutput(id)).toBe(false);
    skipUncertainModel(id);
    expect(getWorkflowRun(id)?.journal.at(-1)).toMatchObject({ type: "after", key });
  });

  it("lists only runs owned by the session and marks an interrupted retry for manual review", () => {
    const saved = saveWorkflow("recover", approval, "session-recover-list");
    const { id } = createWorkflowRun(saved.id, "session-recover-list");
    updateWorkflowRun(id, "pending-review", "Retrying model effect; cancellation is available.");
    expect(listWorkflowRuns("session-other").some((run) => run.id === id)).toBe(false);
    expect(listWorkflowRuns("session-recover-list")).toEqual(expect.arrayContaining([expect.objectContaining({ id, status: "pending-review" })]));
    recoverWorkflowRuns();
    expect(getWorkflowRun(id)).toMatchObject({ status: "pending-review", detail: expect.stringContaining("inspect effect") });
  });

  it("recovers interrupted runs and enforces unique before/after keys and human-only approval", () => {
    const saved = saveWorkflow("review", approval, "session-2");
    const { id } = createWorkflowRun(saved.id, "session-2");
    recoverWorkflowRuns();
    expect(getWorkflowRun(id)?.status).toBe("interrupted");
    updateWorkflowRun(id, "running");
    appendWorkflowEvent({ type: "transition", runId: id, step: 0, nodeId: "start", nextId: "review", outcome: "next" });
    const before = { type: "before" as const, runId: id, step: 1, nodeId: "review", key: workflowEffectKey(id, 1, "review") };
    appendWorkflowEvent(before);
    expect(() => appendWorkflowEvent(before)).toThrow();
    updateWorkflowRun(id, "pending-review");
    recordApproval(id, false);
    expect(getWorkflowRun(id)?.journal.at(-1)).toMatchObject({ type: "after", outcome: "denied", key: before.key });
    expect(() => recordApproval(id, true)).toThrow(/Only approval/);
  });
});
