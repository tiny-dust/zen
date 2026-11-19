import { ipcRenderer } from "electron";

import type { WorkflowGraph } from "@zen/agent-core/src/workflow";

type WorkflowSnapshot = {
  graph: WorkflowGraph;
  nodeSettings: Record<string, { instructions?: string; providerId?: string; modelId?: string; left?: string; right?: string; operator?: "equals" | "not-equals" }>;
  budgets: { maxSteps: number; maxEffects: number; maxWallMs: number };
};

export const workflowApi = {
  workflow: {
    list(sessionId: string): Promise<Array<{ id: string; name: string; current_version: number; created_at: number }>> {
      return ipcRenderer.invoke("workflow:list", sessionId);
    },
    listRuns(sessionId: string): Promise<Array<{ id: string; workflow_id: string; version: number; session_id: string; status: string; detail: string | null; created_at: number; updated_at: number }>> {
      return ipcRenderer.invoke("workflow:list-runs", sessionId);
    },
    open(id: string, sessionId: string, version?: number): Promise<unknown> {
      return ipcRenderer.invoke("workflow:open", id, version, sessionId);
    },
    save(name: string, snapshot: WorkflowSnapshot, sessionId: string, id?: string): Promise<{ id: string; version: number }> {
      return ipcRenderer.invoke("workflow:save", name, snapshot, id, sessionId);
    },
    start(workflowId: string, sessionId: string): Promise<unknown> {
      return ipcRenderer.invoke("workflow:start", workflowId, sessionId);
    },
    get(id: string, sessionId: string): Promise<unknown> {
      return ipcRenderer.invoke("workflow:get", id, sessionId);
    },
    resume(id: string, sessionId: string): Promise<unknown> {
      return ipcRenderer.invoke("workflow:resume", id, sessionId);
    },
    cancel(id: string, sessionId: string): Promise<{ ok: boolean; status: string }> {
      return ipcRenderer.invoke("workflow:cancel", id, sessionId);
    },
    review(id: string, decision: boolean | "skip" | "retry", sessionId: string, confirmation?: string): Promise<unknown> {
      return ipcRenderer.invoke("workflow:review", id, decision, confirmation, sessionId);
    },
  },
};
