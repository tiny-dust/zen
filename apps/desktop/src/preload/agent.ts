import { ipcRenderer } from "electron";

import type {
  AgentRunRequest,
  AgentSettings,
  AgentStreamEvent,
  AskUserAnswer,
  FileCheckpoint,
  PromptPreset,
  SkillSummary,
  ToolApprovalDecision,
  WebSearchApiProviderId,
  WebSearchStatus,
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
    /** 手动重试失败/取消的子 Agent（右栏 Agents 面板「重试」按钮） */
    retrySubAgent(
      sessionId: string,
      agentId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:retry-sub-agent", sessionId, agentId);
    },
    insert(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:insert", sessionId, text);
    },
    /** 运行中转向：打断当前 run，新指示以最高权重先执行后自动恢复原任务 */
    steer(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:steer", sessionId, text);
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
    /** 会话文件快照：写/改文件前的原文件备份，最新在前 */
    listCheckpoints(sessionId: string): Promise<FileCheckpoint[]> {
      return ipcRenderer.invoke("agent:checkpoints:list", sessionId);
    },
    restoreCheckpoint(
      sessionId: string,
      checkpointId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:checkpoints:restore", sessionId, checkpointId);
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
    /** 网络搜索供应商 Key 状态（masked 为脱敏预览，仅设置页展示用） */
    webSearchStatus(): Promise<WebSearchStatus> {
      return ipcRenderer.invoke("agent:websearch-status");
    },
    setWebSearchKey(
      provider: WebSearchApiProviderId,
      key: string | null,
    ): Promise<WebSearchStatus> {
      return ipcRenderer.invoke("agent:websearch-set-key", provider, key);
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
