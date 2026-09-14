import type {
  AgentRunRequest,
  AgentStreamEvent,
  AppSettings,
  AuthState,
} from "@zen/shared";

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
  auth: {
    state(): Promise<AuthState>;
    login(): Promise<AuthState>;
    logout(): Promise<AuthState>;
    onChanged(handler: (state: AuthState) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(partial: Partial<AppSettings>): Promise<AppSettings>;
    pickIcon(): Promise<AppSettings>;
    applyIcon(): Promise<AppSettings>;
    onChanged(handler: (settings: AppSettings) => void): () => void;
  };
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }>;
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    onEvent(handler: (event: AgentStreamEvent) => void): () => void;
  };
}
