import { BrowserWindow, ipcMain } from "electron";

import { listSkills } from "@zen/skills";

import type { AgentSettings, SkillSummary } from "@zen/shared";
import { showOpenDialogSafe } from "./dialog-safe";
import { PROMPT_PRESETS } from "./prompt-presets";
import { rebuildSandbox } from "./sandbox";
import { loadAgentSettings, saveAgentSettings, zenSandboxRoot } from "./zen-dir";

/**
 * Agent 域 IPC：agent 设置（~/.zen/config.json）、技能列表、沙箱、提示词预设。
 * MCP 配置在 mcp-ipc.ts，云同步在 config-sync.ts。
 */

export function registerAgentIpc(broadcast: (channel: string, payload: unknown) => void): void {
  ipcMain.handle("agent:get-settings", async (): Promise<AgentSettings> => {
    return loadAgentSettings();
  });

  ipcMain.handle(
    "agent:set-settings",
    async (_event, partial: Partial<AgentSettings>): Promise<AgentSettings> => {
      if (!partial || typeof partial !== "object") {
        return loadAgentSettings();
      }
      const next = await saveAgentSettings(partial);
      broadcast("agent:settings-changed", next);
      return next;
    },
  );

  ipcMain.handle("agent:list-skills", async (): Promise<SkillSummary[]> => {
    const settings = await loadAgentSettings();
    return listSkills(settings.skillExtraPaths);
  });

  ipcMain.handle("agent:pick-directory", async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "选择目录",
      properties: ["openDirectory"],
    };
    const result = await showOpenDialogSafe(win, options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("agent:prompt-presets", () => PROMPT_PRESETS);

  ipcMain.handle("agent:sandbox-dir", () => zenSandboxRoot());

  ipcMain.handle("agent:rebuild-sandbox", async (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || !projectPath) {
      return { ok: false, error: "invalid project path" };
    }
    try {
      const dir = await rebuildSandbox(projectPath);
      return { ok: true, dir };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "重建隔离区失败",
      };
    }
  });
}
