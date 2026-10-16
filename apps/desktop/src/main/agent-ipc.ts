import { BrowserWindow, ipcMain } from "electron";

import { listSkillFiles, listSkills, readSkillFile } from "@zen/skills";

import type {
  AgentSettings,
  SkillFileContent,
  SkillFileInfo,
  SkillSummary,
  WebSearchApiProviderId,
  WebSearchStatus,
} from "@zen/shared";
import { showOpenDialogSafe } from "./dialog-safe";
import { currentLocale } from "./i18n";
import { syncLarkGatewayWithSettings } from "./lark/ipc";
import { localizedPromptPresets } from "./prompt-presets";
import { rebuildSandbox } from "./sandbox";
import {
  getWebSearchStatus,
  saveWebSearchApiKey,
  WEB_SEARCH_API_PROVIDERS,
} from "./websearch-auth-store";
import { loadAgentSettings, saveAgentSettings, zenSandboxRoot } from "./zen-dir";

/**
 * Agent 域 IPC：agent 设置（~/.zen/config.json）、技能列表、沙箱、提示词预设、
 * 网络搜索供应商 Key。MCP 配置在 mcp-ipc.ts，云同步在 config-sync.ts。
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
      // 飞书桥接随设置启停（异步：内部含 auth 探测，不阻塞设置返回）
      void syncLarkGatewayWithSettings(next);
      return next;
    },
  );

  ipcMain.handle("agent:list-skills", async (): Promise<SkillSummary[]> => {
    const settings = await loadAgentSettings();
    return listSkills(settings.skillExtraPaths);
  });

  // 技能调用 tag 弹窗：技能目录文件枚举（dir 来自 listSkills 结果，仍在 @zen/skills 内做根目录校验）
  ipcMain.handle(
    "agent:skill-files",
    async (_event, dir: string): Promise<SkillFileInfo[]> => {
      const settings = await loadAgentSettings();
      return listSkillFiles(String(dir ?? ""), settings.skillExtraPaths);
    },
  );

  ipcMain.handle(
    "agent:read-skill-file",
    async (_event, dir: string, path: string): Promise<SkillFileContent> => {
      const settings = await loadAgentSettings();
      return readSkillFile(String(dir ?? ""), String(path ?? ""), settings.skillExtraPaths);
    },
  );

  ipcMain.handle("agent:pick-directory", async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "选择目录",
      properties: ["openDirectory"],
    };
    const result = await showOpenDialogSafe(win, options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("agent:prompt-presets", async () =>
    localizedPromptPresets(await currentLocale()),
  );

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

  ipcMain.handle("agent:websearch-status", async (): Promise<WebSearchStatus> => {
    return getWebSearchStatus();
  });

  ipcMain.handle(
    "agent:websearch-set-key",
    async (
      _event,
      provider: WebSearchApiProviderId,
      key: string | null,
    ): Promise<WebSearchStatus> => {
      // 渲染层传来的 provider 不可信：非法值不落库也不抛，返回当前状态（与 set-settings 容错口径一致）
      if (!(WEB_SEARCH_API_PROVIDERS as readonly string[]).includes(provider)) {
        return getWebSearchStatus();
      }
      await saveWebSearchApiKey(provider, key);
      return getWebSearchStatus();
    },
  );
}
