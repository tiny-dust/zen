import type { AgentRunRequest, AgentStreamEvent } from "@zen/shared";

export interface AppInfo {
  workspaceRoot: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

export interface ZenApi {
  app: {
    info(): Promise<AppInfo>;
  };
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }>;
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    onEvent(handler: (event: AgentStreamEvent) => void): () => void;
  };
}
