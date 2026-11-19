/** Isolated workflow graph and journal-driven runner. Adapters own all external effects. */
export type WorkflowEffectNode =
  | { id: string; type: "model" | "tool" | "script" | "http"; idempotent: boolean }
  | { id: string; type: "approval"; idempotent: boolean };

export type WorkflowNode =
  | { id: string; type: "start" | "end" }
  | WorkflowEffectNode
  | { id: string; type: "condition" }
  | { id: string; type: "loop"; maxIterations?: number };

export type WorkflowEdge = { from: string; to: string; label: "next" | "true" | "false" | "body" | "exit" | "approved" | "denied" };
export type WorkflowGraph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
export type WorkflowBudgets = { maxSteps: number; maxEffects: number };
export type WorkflowEvent =
  | { type: "before"; runId: string; step: number; nodeId: string; key: string }
  | { type: "after"; runId: string; step: number; nodeId: string; key: string; outcome: WorkflowEdge["label"] }
  | { type: "transition"; runId: string; step: number; nodeId: string; nextId: string; outcome: WorkflowEdge["label"] };

/** append must durably commit one event before resolving; one writer per runId is required. */
export interface WorkflowJournal {
  load(runId: string): Promise<readonly WorkflowEvent[]>;
  append(event: WorkflowEvent): Promise<void>;
}

export interface WorkflowAdapters {
  execute(node: Extract<WorkflowEffectNode, { type: "model" | "tool" | "script" | "http" }>, context: { runId: string; key: string; signal?: AbortSignal }): Promise<void>;
  requestApproval(node: Extract<WorkflowEffectNode, { type: "approval" }>, context: { runId: string; key: string; signal?: AbortSignal }): Promise<boolean>;
  evaluateCondition(node: Extract<WorkflowNode, { type: "condition" }>, signal?: AbortSignal): Promise<boolean>;
  shouldContinue(node: Extract<WorkflowNode, { type: "loop" }>, iteration: number, signal?: AbortSignal): Promise<boolean>;
}

export type WorkflowResult = { status: "completed" | "cancelled" | "budget-exhausted" | "pending-review" | "failed"; nodeId: string; steps: number; effects: number };

function labelsFor(node: WorkflowNode): readonly WorkflowEdge["label"][] {
  switch (node.type) {
    case "end": return [];
    case "condition": return ["true", "false"];
    case "loop": return ["body", "exit"];
    case "approval": return ["approved", "denied"];
    default: return ["next"];
  }
}

export function validateWorkflow(graph: WorkflowGraph): void {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (!node.id || nodes.has(node.id)) throw new Error(`Invalid or duplicate node id: ${node.id}`);
    if (node.type === "loop" && node.maxIterations !== undefined && (!Number.isSafeInteger(node.maxIterations) || node.maxIterations < 0)) {
      throw new Error(`Invalid loop limit: ${node.id}`);
    }
    nodes.set(node.id, node);
  }
  if (graph.nodes.filter((node) => node.type === "start").length !== 1 || !graph.nodes.some((node) => node.type === "end")) {
    throw new Error("Workflow needs exactly one start and at least one end");
  }
  const edges = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.from);
    if (!source || !nodes.has(edge.to)) throw new Error(`Dangling edge: ${edge.from} -> ${edge.to}`);
    if (!labelsFor(source).includes(edge.label)) throw new Error(`Invalid edge label: ${edge.from}:${edge.label}`);
    const labels = edges.get(edge.from) ?? new Set<string>();
    if (labels.has(edge.label)) throw new Error(`Duplicate edge label: ${edge.from}:${edge.label}`);
    labels.add(edge.label);
    edges.set(edge.from, labels);
  }
  for (const node of graph.nodes) {
    if (labelsFor(node).some((label) => !edges.get(node.id)?.has(label)) || (edges.get(node.id)?.size ?? 0) !== labelsFor(node).length) {
      throw new Error(`Missing edge: ${node.id}`);
    }
  }
  const start = graph.nodes.find((node) => node.type === "start");
  if (!start) throw new Error("Missing start");
  const visited = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    queue.push(...graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to));
  }
  if (visited.size !== graph.nodes.length) throw new Error("Unreachable workflow node");
  // Every node must have a route to an end, even if a runtime loop can exhaust its budget first.
  const canExit = new Set(graph.nodes.filter((node) => node.type === "end").map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (canExit.has(edge.to) && !canExit.has(edge.from)) { canExit.add(edge.from); changed = true; }
    }
  }
  if (canExit.size !== nodes.size) throw new Error("Workflow contains a node with no path to end");
}

/** Keys include run identity and visit index, so revisiting a node never reuses a previous effect key. */
export function workflowEffectKey(runId: string, step: number, nodeId: string): string {
  return JSON.stringify([runId, step, nodeId]);
}

export async function runWorkflow(options: {
  graph: WorkflowGraph;
  runId: string;
  budgets: WorkflowBudgets;
  journal: WorkflowJournal;
  adapters: WorkflowAdapters;
  signal?: AbortSignal;
}): Promise<WorkflowResult> {
  const { graph, runId, budgets, journal, adapters, signal } = options;
  validateWorkflow(graph);
  if (!runId || !Number.isSafeInteger(budgets.maxSteps) || budgets.maxSteps < 1 || !Number.isSafeInteger(budgets.maxEffects) || budgets.maxEffects < 0) {
    throw new Error("Invalid run identity or budgets");
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = graph.nodes.find((node) => node.type === "start");
  if (!start) throw new Error("Missing start");
  let nodeId = start.id;
  let steps = 0;
  let effects = 0;
  const iterations = new Map<string, number>();
  const records = new Map<number, { before?: Extract<WorkflowEvent, { type: "before" }>; after?: Extract<WorkflowEvent, { type: "after" }> }>();
  for (const event of await journal.load(runId)) {
    if (event.runId !== runId || event.step !== steps || event.nodeId !== nodeId) throw new Error("Invalid workflow journal sequence");
    const node = nodes.get(nodeId);
    if (!node) throw new Error("Invalid workflow journal node");
    const record = records.get(steps) ?? {};
    if (event.type === "before") {
      if (!isEffect(node) || record.before || event.key !== workflowEffectKey(runId, steps, nodeId)) throw new Error("Invalid before event");
      record.before = event;
      effects++;
    } else if (event.type === "after") {
      if (!record.before || record.after || event.key !== record.before.key || !labelsFor(node).includes(event.outcome)) throw new Error("Invalid after event");
      record.after = event;
    } else {
      const edge = graph.edges.find((item) => item.from === nodeId && item.label === event.outcome);
      if (!edge || edge.to !== event.nextId || (isEffect(node) && record.after?.outcome !== event.outcome) || (!isEffect(node) && (record.before || record.after))) {
        throw new Error("Invalid transition event");
      }
      if (node.type === "loop" && event.outcome === "body") iterations.set(node.id, (iterations.get(node.id) ?? 0) + 1);
      nodeId = event.nextId;
      steps++;
    }
    records.set(event.step, record);
  }
  for (;;) {
    const node = nodes.get(nodeId);
    if (!node) throw new Error("Invalid workflow node");
    const result = (status: WorkflowResult["status"]): WorkflowResult => ({ status, nodeId, steps, effects });
    if (node.type === "end") return result("completed");
    const record = records.get(steps);
    if (record?.before && !record.after && isEffect(node) && !node.idempotent) return result("pending-review");
    if (signal?.aborted) return result("cancelled");
    if (steps >= budgets.maxSteps || effects > budgets.maxEffects) return result("budget-exhausted");
    let outcome: WorkflowEdge["label"];
    if (record?.after) {
      outcome = record.after.outcome;
    } else if (isEffect(node)) {
      if (!record?.before) {
        if (effects >= budgets.maxEffects) return result("budget-exhausted");
        await journal.append({ type: "before", runId, step: steps, nodeId, key: workflowEffectKey(runId, steps, nodeId) });
        effects++;
      }
      if (signal?.aborted) return result(node.idempotent ? "cancelled" : "pending-review");
      const key = workflowEffectKey(runId, steps, nodeId);
      try {
        if (node.type === "approval") {
          outcome = (await adapters.requestApproval(node, { runId, key, signal })) ? "approved" : "denied";
        } else {
          await adapters.execute(node, { runId, key, signal });
          outcome = "next";
        }
      } catch {
        return result(node.idempotent ? "failed" : "pending-review");
      }
      await journal.append({ type: "after", runId, step: steps, nodeId, key, outcome });
    } else if (node.type === "condition") {
      outcome = (await adapters.evaluateCondition(node, signal)) ? "true" : "false";
    } else if (node.type === "loop") {
      const count = iterations.get(node.id) ?? 0;
      outcome = node.maxIterations !== undefined && count >= node.maxIterations
        ? "exit"
        : (await adapters.shouldContinue(node, count, signal)) ? "body" : "exit";
    } else {
      outcome = "next";
    }
    if (signal?.aborted && !record?.after && !isEffect(node)) return result("cancelled");
    const edge = graph.edges.find((item) => item.from === nodeId && item.label === outcome);
    if (!edge) throw new Error("Missing runtime edge");
    await journal.append({ type: "transition", runId, step: steps, nodeId, nextId: edge.to, outcome });
    if (node.type === "loop" && outcome === "body") iterations.set(node.id, (iterations.get(node.id) ?? 0) + 1);
    nodeId = edge.to;
    steps++;
  }
}

function isEffect(node: WorkflowNode): node is WorkflowEffectNode {
  return node.type === "model" || node.type === "tool" || node.type === "script" || node.type === "http" || node.type === "approval";
}
