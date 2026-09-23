import { ipcRenderer } from "electron";

import type {
  AgentRunRequest,
  AgentSettings,
  AgentStreamEvent,
  AskUserAnswer,
  PromptPreset,
  SkillSummary,
  ToolApprovalDecision,
} from "@zen/shared";

export const agentApi = {
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:run", request);
    },
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:cancel", sessionId);
    },
    pause(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:pause", sessionId);
    },
    resume(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:resume", sessionId);
    },
    insert(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:insert", sessionId, text);
    },
    resolveApproval(
      sessionId: string,
      decision: ToolApprovalDecision,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:approval", sessionId, decision);
    },
    resolveAsk(
      sessionId: string,
      answer: AskUserAnswer,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:ask-resolve", sessionId, answer);
    },
    getSettings(): Promise<AgentSettings> {
      return ipcRenderer.invoke("agent:get-settings");
    },
    setSettings(partial: Partial<AgentSettings>): Promise<AgentSettings> {
      return ipcRenderer.invoke("agent:set-settings", partial);
    },
    listSkills(): Promise<SkillSummary[]> {
      return ipcRenderer.invoke("agent:list-skills");
    },
    pickDirectory(): Promise<string | null> {
      return ipcRenderer.invoke("agent:pick-directory");
    },
    promptPresets(): Promise<PromptPreset[]> {
      return ipcRenderer.invoke("agent:prompt-presets");
    },
    sandboxDir(): Promise<string> {
      return ipcRenderer.invoke("agent:sandbox-dir");
    },
    rebuildSandbox(
      projectPath: string,
    ): Promise<{ ok: boolean; dir?: string; error?: string }> {
      return ipcRenderer.invoke("agent:rebuild-sandbox", projectPath);
    },
    onSettingsChanged(handler: (settings: AgentSettings) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, settings: AgentSettings) => {
        handler(settings);
      };
      ipcRenderer.on("agent:settings-changed", listener);
      return () => {
        ipcRenderer.removeListener("agent:settings-changed", listener);
      };
    },
    onEvent(handler: (event: AgentStreamEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, event: AgentStreamEvent) => {
        handler(event);
      };
      ipcRenderer.on("agent:event", listener);
      return () => {
        ipcRenderer.removeListener("agent:event", listener);
      };
    },
  },
};
