import { ipcRenderer } from "electron";

export const skillsApi = {
  skills: {
    marketSearch(query: string) {
      return ipcRenderer.invoke("skills:market-search", query);
    },
    marketInstall(hit: import("@zen/shared").SkillMarketHit) {
      return ipcRenderer.invoke("skills:market-install", hit);
    },
    uninstall(skill: import("@zen/shared").SkillSummary) {
      return ipcRenderer.invoke("skills:uninstall", skill);
    },
    analyze(req: { providerId: string; modelId: string }) {
      return ipcRenderer.invoke("skills:analyze", req);
    },
    /** 订阅一键分析的流式增量（skills:analyze 期间 main 定向推送） */
    onAnalyzeEvent(handler: (event: { text: string }) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: { text: string }) => {
        handler(payload);
      };
      ipcRenderer.on("skills:analyze-event", listener);
      return () => {
        ipcRenderer.removeListener("skills:analyze-event", listener);
      };
    },
    userRoot(): Promise<string> {
      return ipcRenderer.invoke("skills:user-root");
    },
  },
};
