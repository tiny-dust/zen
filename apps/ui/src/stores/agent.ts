import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  AgentSettings,
  McpServerConfig,
  McpServerStatus,
  PromptPreset,
  SkillSummary,
  SyncResult,
} from "@zen/shared";
import { DEFAULT_AGENT_SETTINGS, PERMISSION_MODES } from "@zen/shared";
import { useUserStore } from "@/stores/user";

/** Agent 域设置（~/.zen/config.json）+ 技能/MCP/提示词/同步的 UI 状态 */
export const useAgentStore = defineStore("agent", () => {
  const settings = ref<AgentSettings>({ ...DEFAULT_AGENT_SETTINGS });
  const skills = ref<SkillSummary[]>([]);
  const mcpStatuses = ref<McpServerStatus[]>([]);
  const presets = ref<PromptPreset[]>([]);
  const sandboxDir = ref("");
  const syncBusy = ref(false);
  const lastSync = ref<SyncResult | null>(null);

  const permissionMode = computed(() => settings.value.permissionMode);
  const permissionLabel = computed(
    () => PERMISSION_MODES.find((item) => item.id === permissionMode.value)?.label ?? "",
  );

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen?.agent) {
      return () => undefined;
    }
    void zen.agent.getSettings().then((value) => {
      settings.value = value;
    });
    void zen.agent.promptPresets().then((items) => {
      presets.value = items;
    });
    void zen.agent.sandboxDir().then((dir) => {
      sandboxDir.value = dir;
    });
    void refreshSkills();
    void refreshMcp();
    return zen.agent.onSettingsChanged((value) => {
      settings.value = value;
    });
  }

  async function updateSettings(partial: Partial<AgentSettings>): Promise<void> {
    const zen = window.zen;
    if (!zen?.agent) {
      return;
    }
    settings.value = await zen.agent.setSettings(partial);
  }

  async function refreshSkills(): Promise<void> {
    const zen = window.zen;
    if (!zen?.agent) {
      return;
    }
    skills.value = await zen.agent.listSkills();
  }

  async function refreshMcp(): Promise<void> {
    const zen = window.zen;
    if (!zen?.mcp) {
      return;
    }
    mcpStatuses.value = await zen.mcp.list();
  }

  async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
    const zen = window.zen;
    if (!zen?.mcp) {
      return;
    }
    mcpStatuses.value = await zen.mcp.setServers(servers);
  }

  async function pickDirectory(): Promise<string | null> {
    const zen = window.zen;
    return zen?.agent ? zen.agent.pickDirectory() : null;
  }

  async function rebuildSandbox(projectPath: string): Promise<{ ok: boolean; error?: string }> {
    const zen = window.zen;
    if (!zen?.agent) {
      return { ok: false };
    }
    return zen.agent.rebuildSandbox(projectPath);
  }

  async function syncUpload(): Promise<SyncResult> {
    const zen = window.zen;
    if (!zen?.sync) {
      return { ok: false, error: "bridge 未就绪" };
    }
    if (!useUserStore().auth.loggedIn) {
      return { ok: false, error: "配置云同步需要登录 GitHub" };
    }
    syncBusy.value = true;
    try {
      lastSync.value = await zen.sync.upload();
      return lastSync.value;
    } finally {
      syncBusy.value = false;
    }
  }

  async function syncDownload(): Promise<SyncResult> {
    const zen = window.zen;
    if (!zen?.sync) {
      return { ok: false, error: "bridge 未就绪" };
    }
    if (!useUserStore().auth.loggedIn) {
      return { ok: false, error: "配置云同步需要登录 GitHub" };
    }
    syncBusy.value = true;
    try {
      lastSync.value = await zen.sync.download();
      return lastSync.value;
    } finally {
      syncBusy.value = false;
    }
  }

  return {
    settings,
    skills,
    mcpStatuses,
    presets,
    sandboxDir,
    syncBusy,
    lastSync,
    permissionMode,
    permissionLabel,
    bootstrap,
    updateSettings,
    refreshSkills,
    refreshMcp,
    saveMcpServers,
    pickDirectory,
    rebuildSandbox,
    syncUpload,
    syncDownload,
  };
});
