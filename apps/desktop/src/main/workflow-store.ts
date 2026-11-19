import { randomUUID } from "node:crypto";

import { validateWorkflow, workflowEffectKey } from "@zen/agent-core";
import type { WorkflowEvent, WorkflowGraph, WorkflowJournal } from "@zen/agent-core";

import { getDb } from "./model-db-connection";

export type WorkflowSnapshot = {
  graph: WorkflowGraph;
  nodeSettings: Record<string, { prompt?: string; providerId?: string; modelId?: string; instructions?: string; expression?: string; left?: string; right?: string; operator?: "equals" | "not-equals" }>;
  budgets: { maxSteps: number; maxEffects: number; maxWallMs: number };
  /** 画布位置（可选；旧版本快照没有该字段，回读时由渲染层自动排版） */
  layout?: Record<string, { x: number; y: number }>;
};
export type WorkflowRun = {
  id: string; workflow_id: string; version: number; session_id: string;
  status: string; detail: string | null; created_at: number; updated_at: number;
};

type VersionRow = { snapshot_json: string };
type JournalRow = { event_json: string };

export function parseSnapshot(input: unknown): WorkflowSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid workflow snapshot");
  const raw = input as Record<string, unknown>;
  const graph = raw.graph as WorkflowGraph;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 200 || graph.edges.length > 400) {
    throw new Error("Invalid workflow graph");
  }
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || node.id.length > 128 ||
      !["start", "end", "model", "tool", "script", "http", "approval", "condition", "loop"].includes(node.type)) {
      throw new Error("Invalid workflow node");
    }
    if (["tool", "script", "http"].includes(node.type)) throw new Error(`${node.type} execution is disabled until permission and lifetime integration is available`);
    if ((node.type === "model" || node.type === "approval") && node.idempotent !== false) {
      throw new Error("Effects must be non-idempotent: uncertain outcomes require review");
    }
    if (node.type === "loop" && node.maxIterations !== undefined && (!Number.isSafeInteger(node.maxIterations) || node.maxIterations < 0)) {
      throw new Error("Invalid loop maxIterations");
    }
  }
  for (const edge of graph.edges) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string" ||
      !["next", "true", "false", "body", "exit", "approved", "denied"].includes(edge.label)) {
      throw new Error("Invalid workflow edge");
    }
  }
  validateWorkflow(graph);
  const settings = raw.nodeSettings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Invalid node settings");
  const nodeSettings = settings as WorkflowSnapshot["nodeSettings"];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const [id, value] of Object.entries(nodeSettings)) {
    if (!nodeIds.has(id) || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid node settings");
  }
  for (const node of graph.nodes) {
    const setting = nodeSettings[node.id];
    if (node.type === "model") {
      const prompt = setting?.instructions ?? setting?.prompt;
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20_000) throw new Error(`Model instructions required: ${node.id}`);
      if (typeof setting?.providerId !== "string" || !setting.providerId.trim() ||
        typeof setting.modelId !== "string" || !setting.modelId.trim()) throw new Error(`Model provider and model required: ${node.id}`);
    }
    if (node.type === "condition") {
      if (setting?.expression !== undefined) throw new Error(`Condition expression is disabled until a safe evaluator is available: ${node.id}`);
      if (typeof setting?.left !== "string" || typeof setting.right !== "string" ||
        !["equals", "not-equals"].includes(setting.operator ?? "")) throw new Error(`Condition comparison required: ${node.id}`);
    }
  }
  const rawBudgets = raw.budgets as Partial<WorkflowSnapshot["budgets"]> | undefined;
  const budgets = { maxSteps: rawBudgets?.maxSteps, maxEffects: rawBudgets?.maxEffects, maxWallMs: rawBudgets?.maxWallMs ?? 300_000 };
  if (typeof budgets.maxSteps !== "number" || !Number.isSafeInteger(budgets.maxSteps) || budgets.maxSteps < 1 || budgets.maxSteps > 10_000 ||
    typeof budgets.maxEffects !== "number" || !Number.isSafeInteger(budgets.maxEffects) || budgets.maxEffects < 0 || budgets.maxEffects > 1_000 ||
    !Number.isSafeInteger(budgets.maxWallMs) || budgets.maxWallMs < 1000 || budgets.maxWallMs > 86_400_000) {
    throw new Error("Invalid workflow budgets");
  }
  const rawLayout = (input as Record<string, unknown>).layout as unknown;
  let layout: Record<string, { x: number; y: number }> | undefined;
  if (rawLayout !== undefined) {
    if (!rawLayout || typeof rawLayout !== "object" || Array.isArray(rawLayout)) throw new Error("Invalid workflow layout");
    layout = {};
    for (const [id, value] of Object.entries(rawLayout as Record<string, unknown>)) {
      const point = value as { x?: unknown; y?: unknown } | null;
      if (!nodeIds.has(id) || !point || typeof point !== "object" ||
        typeof point.x !== "number" || typeof point.y !== "number" ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error("Invalid workflow layout");
      }
      layout[id] = { x: Math.round(point.x), y: Math.round(point.y) };
    }
  }
  const serialized = JSON.stringify({ graph, nodeSettings, budgets: { ...budgets }, ...(layout ? { layout } : {}) });
  if (serialized.length > 1_000_000) throw new Error("Workflow snapshot too large");
  return JSON.parse(serialized) as WorkflowSnapshot;
}

export function saveWorkflow(name: unknown, input: unknown, sessionId: string, id?: unknown) {
  if (typeof name !== "string" || !name.trim() || name.length > 120 || !sessionId ||
    (id !== undefined && (typeof id !== "string" || !id.trim()))) throw new Error("Invalid workflow identity");
  const snapshot = parseSnapshot(input);
  const db = getDb();
  return db.transaction(() => {
    const workflowId = typeof id === "string" ? id : randomUUID();
    const current = db.prepare("SELECT current_version FROM workflow_definitions WHERE id = ? AND owner_session_id = ?").get(workflowId, sessionId) as { current_version: number } | undefined;
    if (id !== undefined && !current) throw new Error("Workflow not found");
    const version = (current?.current_version ?? 0) + 1;
    if (current) db.prepare("UPDATE workflow_definitions SET name = ?, current_version = ? WHERE id = ? AND owner_session_id = ?").run(name.trim(), version, workflowId, sessionId);
    else db.prepare("INSERT INTO workflow_definitions (id, name, current_version, created_at, owner_session_id) VALUES (?, ?, ?, ?, ?)").run(workflowId, name.trim(), version, Date.now(), sessionId);
    db.prepare("INSERT INTO workflow_versions (workflow_id, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)")
      .run(workflowId, version, JSON.stringify(snapshot), Date.now());
    return { id: workflowId, version };
  })();
}

export function listWorkflows(sessionId: string) {
  if (!sessionId) throw new Error("Session required");
  return getDb().prepare("SELECT id, name, current_version, created_at FROM workflow_definitions WHERE owner_session_id = ? ORDER BY created_at DESC").all(sessionId);
}

export function openWorkflow(id: string, sessionId: string, version?: number) {
  if (!sessionId) throw new Error("Session required");
  const db = getDb();
  const definition = db.prepare("SELECT id, name, current_version, created_at FROM workflow_definitions WHERE id = ? AND owner_session_id = ?").get(id, sessionId) as { current_version: number } | undefined;
  if (!definition) return null;
  const selected = version ?? definition.current_version;
  const row = db.prepare("SELECT snapshot_json FROM workflow_versions WHERE workflow_id = ? AND version = ?").get(id, selected) as VersionRow | undefined;
  return row ? { ...definition, version: selected, snapshot: parseSnapshot(JSON.parse(row.snapshot_json)) } : null;
}

export function createWorkflowRun(workflowId: string, sessionId: string) {
  const workflow = openWorkflow(workflowId, sessionId);
  if (!workflow) throw new Error("Workflow not found");
  const id = randomUUID();
  const now = Date.now();
  getDb().prepare("INSERT INTO workflow_runs (id, workflow_id, version, session_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)")
    .run(id, workflowId, workflow.version, sessionId, now, now);
  return { id, snapshot: workflow.snapshot };
}

export function listWorkflowRuns(sessionId: string): WorkflowRun[] {
  if (!sessionId) throw new Error("Session required");
  return getDb().prepare(`SELECT r.* FROM workflow_runs r
    JOIN workflow_definitions d ON d.id = r.workflow_id
    WHERE r.session_id = ? AND d.owner_session_id = ?
    ORDER BY r.created_at DESC, r.rowid DESC LIMIT 50`).all(sessionId, sessionId) as WorkflowRun[];
}

export function getWorkflowRun(id: string) {
  const run = getDb().prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRun | undefined;
  if (!run) return null;
  const workflow = openWorkflow(run.workflow_id, run.session_id, run.version);
  if (!workflow) return null;
  const outputs = getDb().prepare("SELECT key, node_id, output FROM workflow_outputs WHERE run_id = ? ORDER BY rowid").all(id) as Array<{ key: string; node_id: string; output: string }>;
  return { ...run, snapshot: workflow.snapshot, journal: loadWorkflowEvents(id), outputs };
}

export function updateWorkflowRun(id: string, status: string, detail: string | null = null): void {
  getDb().prepare("UPDATE workflow_runs SET status = ?, detail = ?, updated_at = ? WHERE id = ?").run(status, detail, Date.now(), id);
}

export function recoverWorkflowRuns(): void {
  getDb().prepare("UPDATE workflow_runs SET status = 'interrupted', detail = 'Application exited while run was active; inspect journal before resuming', updated_at = ? WHERE status = 'running'")
    .run(Date.now());
  getDb().prepare("UPDATE workflow_runs SET detail = 'Application exited during model retry; inspect effect before deciding again', updated_at = ? WHERE status = 'pending-review' AND detail = 'Retrying model effect; cancellation is available.'")
    .run(Date.now());
}

export function loadWorkflowEvents(id: string): WorkflowEvent[] {
  return (getDb().prepare("SELECT event_json FROM workflow_journal WHERE run_id = ? ORDER BY seq").all(id) as JournalRow[])
    .map((row) => JSON.parse(row.event_json) as WorkflowEvent);
}

export function appendWorkflowEvent(event: WorkflowEvent): void {
  const db = getDb();
  db.transaction(() => {
    const run = db.prepare("SELECT status FROM workflow_runs WHERE id = ?").get(event.runId) as { status: string } | undefined;
    if (!run || !["running", "pending-review"].includes(run.status)) throw new Error("Run is not writable");
    const last = db.prepare("SELECT seq FROM workflow_journal WHERE run_id = ? ORDER BY seq DESC LIMIT 1").get(event.runId) as { seq: number } | undefined;
    db.prepare("INSERT INTO workflow_journal (run_id, seq, step, type, key, event_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(event.runId, (last?.seq ?? 0) + 1, event.step, event.type, event.type === "transition" ? null : event.key, JSON.stringify(event), Date.now());
  })();
}

export function recordWorkflowOutput(runId: string, key: string, nodeId: string, output: string): void {
  const last = loadWorkflowEvents(runId).at(-1);
  if (!last || last.type !== "before" || last.key !== key || last.nodeId !== nodeId ||
    key !== workflowEffectKey(runId, last.step, nodeId)) throw new Error("Model output has no pending step");
  getDb().prepare("INSERT INTO workflow_outputs (key, run_id, node_id, output, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(key, runId, nodeId, output, Date.now());
}

export function pendingModelStep(id: string) {
  const run = getWorkflowRun(id);
  const last = run?.journal.at(-1);
  if (!run || !last || last.type !== "before" || last.key !== workflowEffectKey(id, last.step, last.nodeId) ||
    run.snapshot.graph.nodes.find((node) => node.id === last.nodeId)?.type !== "model") return null;
  return { run, before: last, output: run.outputs.find((row) => row.key === last.key) };
}

/** Replay only the journal commit, never the external model call. */
export function commitPersistedModelOutput(id: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const pending = pendingModelStep(id);
    if (!pending?.output) return false;
    if (!["running", "interrupted", "pending-review"].includes(pending.run.status)) throw new Error("Run cannot replay");
    if (pending.run.status === "interrupted") updateWorkflowRun(id, "pending-review");
    appendWorkflowEvent({ type: "after", runId: id, step: pending.before.step, nodeId: pending.before.nodeId, key: pending.before.key, outcome: "next" });
    return true;
  })();
}

export function skipUncertainModel(id: string): void {
  const pending = pendingModelStep(id);
  if (!pending || pending.run.status !== "pending-review" || pending.output) throw new Error("No uncertain model effect to skip");
  appendWorkflowEvent({ type: "after", runId: id, step: pending.before.step, nodeId: pending.before.nodeId, key: pending.before.key, outcome: "next" });
}

export function resolveWorkflowValue(runId: string, value: string): string {
  if (!value.startsWith("$")) return value;
  const nodeId = value.slice(1);
  const row = getDb().prepare("SELECT output FROM workflow_outputs WHERE run_id = ? AND node_id = ? ORDER BY rowid DESC LIMIT 1")
    .get(runId, nodeId) as { output: string } | undefined;
  if (!row) throw new Error(`Missing model output: ${nodeId}`);
  return row.output;
}

export const workflowJournal: WorkflowJournal = {
  async load(runId) { return loadWorkflowEvents(runId); },
  async append(event) { appendWorkflowEvent(event); },
};

export function recordApproval(id: string, approved: boolean): void {
  const db = getDb();
  db.transaction(() => {
    const run = getWorkflowRun(id);
    if (!run || run.status !== "pending-review") throw new Error("Run is not pending approval");
    const last = run.journal.at(-1);
    if (!last || last.type !== "before" || run.snapshot.graph.nodes.find((node) => node.id === last.nodeId)?.type !== "approval") {
      throw new Error("Only approval nodes accept a decision; uncertain effects cannot be replayed");
    }
    if (last.key !== workflowEffectKey(id, last.step, last.nodeId)) throw new Error("Invalid step key");
    appendWorkflowEvent({ type: "after", runId: id, step: last.step, nodeId: last.nodeId, key: last.key, outcome: approved ? "approved" : "denied" });
  })();
}
