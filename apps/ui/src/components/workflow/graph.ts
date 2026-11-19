export const NODE_TYPES = ["start", "end", "model", "tool", "condition", "loop", "approval", "script", "http"] as const;
export type WorkflowNodeType = (typeof NODE_TYPES)[number];
export type WorkflowEdgeType = "next" | "true" | "false" | "body" | "exit" | "approved" | "denied";
export type WorkflowBudgets = { maxSteps: number; maxEffects: number };
export type RuntimeWorkflowNode =
  | { id: string; type: "start" | "end" | "condition" }
  | { id: string; type: "loop"; maxIterations?: number }
  | { id: string; type: "model" | "tool" | "script" | "http" | "approval"; idempotent: boolean };

/** Plain JSON editor data. Settings are adapter inputs, not fields consumed by the runner. */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  x: number;
  y: number;
  settings: {
    providerId?: string;
    modelId?: string;
    instructions?: string;
    toolName?: string;
    expression?: string;
    left?: string;
    right?: string;
    operator?: "equals" | "not-equals";
    maxIterations?: number;
    script?: string;
    url?: string;
    method?: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: WorkflowEdgeType;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  budgets?: WorkflowBudgets;
}

export function edgeTypesFor(source: WorkflowNodeType): WorkflowEdgeType[] {
  if (source === "end") return [];
  if (source === "condition") return ["true", "false"];
  if (source === "loop") return ["body", "exit"];
  if (source === "approval") return ["approved", "denied"];
  return ["next"];
}

export function canConnect(graph: WorkflowGraph, source: string, target: string, type: WorkflowEdgeType): boolean {
  const from = graph.nodes.find((node) => node.id === source);
  const to = graph.nodes.find((node) => node.id === target);
  return Boolean(
    from && to && to.type !== "start" &&
    edgeTypesFor(from.type).includes(type) &&
    !graph.edges.some((edge) => edge.source === source && edge.type === type),
  );
}

/** Reject incomplete graphs rather than silently selecting or dropping branch edges. */
export function toRuntimeWorkflow(editor: WorkflowGraph): {
  graph: { nodes: RuntimeWorkflowNode[]; edges: Array<{ from: string; to: string; label: WorkflowEdgeType }> };
  budgets: WorkflowBudgets;
  nodeSettings: Record<string, WorkflowNode["settings"]>;
} {
  const { nodes, edges, budgets } = editor;
  if (!budgets || !Number.isSafeInteger(budgets.maxSteps) || budgets.maxSteps < 1 || !Number.isSafeInteger(budgets.maxEffects) || budgets.maxEffects < 0) {
    throw new Error("Invalid run budgets");
  }
  if (nodes.filter((node) => node.type === "start").length !== 1 || !nodes.some((node) => node.type === "end")) {
    throw new Error("Workflow needs exactly one start and at least one end");
  }
  const ids = new Set<string>();
  const nodeSettings: Record<string, WorkflowNode["settings"]> = Object.create(null);
  for (const node of nodes) {
    if (!node.id || ids.has(node.id) || !NODE_TYPES.includes(node.type)) throw new Error(`Invalid or duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (node.type === "loop" && node.settings.maxIterations !== undefined && (!Number.isSafeInteger(node.settings.maxIterations) || node.settings.maxIterations < 0)) {
      throw new Error(`Invalid loop limit: ${node.id}`);
    }
    if (["tool", "script", "http"].includes(node.type)) throw new Error(`${node.type} nodes cannot be saved or run: execution is disabled`);
    if (node.type === "model") {
      if (!node.settings.providerId?.trim() || !node.settings.modelId?.trim()) throw new Error(`Select a provider and model: ${node.id}`);
      if (!node.settings.instructions?.trim()) throw new Error(`Missing model instructions: ${node.id}`);
    }
    if (node.type === "condition" && (node.settings.expression !== undefined || typeof node.settings.left !== "string" || typeof node.settings.right !== "string" || !["equals", "not-equals"].includes(node.settings.operator ?? ""))) {
      throw new Error(`Condition needs left, right and operator: ${node.id}`);
    }
    nodeSettings[node.id] = { ...node.settings };
  }
  for (const node of nodes) {
    const labels = edgeTypesFor(node.type);
    const outgoing = edges.filter((edge) => edge.source === node.id);
    if (outgoing.length !== labels.length || labels.some((label) => outgoing.filter((edge) => edge.type === label).length !== 1)) {
      throw new Error(`Missing or duplicate edge: ${node.id}`);
    }
  }
  if (edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error("Dangling edge");
  const start = nodes.find((node) => node.type === "start")!;
  const visited = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  if (visited.size !== nodes.length) throw new Error("Unreachable workflow node");
  const canExit = new Set(nodes.filter((node) => node.type === "end").map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (canExit.has(edge.target) && !canExit.has(edge.source)) { canExit.add(edge.source); changed = true; }
    }
  }
  if (canExit.size !== nodes.length) throw new Error("Workflow contains a node with no path to end");
  return {
    graph: {
      nodes: nodes.map((node): RuntimeWorkflowNode => {
        if (node.type === "loop") return { id: node.id, type: "loop", ...(node.settings.maxIterations !== undefined ? { maxIterations: node.settings.maxIterations } : {}) };
        if (node.type === "start" || node.type === "end" || node.type === "condition") return { id: node.id, type: node.type };
        return { id: node.id, type: node.type, idempotent: false };
      }),
      edges: edges.map((edge) => ({ from: edge.source, to: edge.target, label: edge.type })),
    },
    budgets: { ...budgets }, nodeSettings,
  };
}

export function removeNode(graph: WorkflowGraph, id: string): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
  };
}
