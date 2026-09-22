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
    userRoot(): Promise<string> {
      return ipcRenderer.invoke("skills:user-root");
    },
  },
};
