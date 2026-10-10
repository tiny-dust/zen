import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  AgentSettings,
  LarkStatus,
  McpDiscoveredServer,
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
  const larkStatus = ref<LarkStatus | null>(null);

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
    void refreshLark();
    const disposeSettings = zen.agent.onSettingsChanged((value) => {
      settings.value = value;
    });
    const disposeLark = zen.lark?.onChanged((status) => {
      larkStatus.value = status;
    });
    return () => {
      disposeSettings();
      disposeLark?.();
    };
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

  /** needs-auth 服务走 OAuth：主进程跳系统浏览器认证，完成后返回最新状态列表 */
  async function authorizeMcp(serverId: string): Promise<void> {
    const zen = window.zen;
    if (!zen?.mcp) {
      return;
    }
    mcpStatuses.value = await zen.mcp.authorize(serverId);
  }

  /** 飞书桥接状态（lark:status 快照；旧 preload 无 lark 段时保持 null） */
  async function refreshLark(): Promise<void> {
    const zen = window.zen;
    if (!zen?.lark) {
      return;
    }
    larkStatus.value = await zen.lark.status();
  }

  /** 扫描当前仓库与系统里已有的 MCP 配置（Claude Code / Desktop / Cursor 等） */
  async function scanMcp(workspaceRoot?: string): Promise<McpDiscoveredServer[]> {
    const zen = window.zen;
    if (!zen?.mcp) {
      return [];
    }
    return zen.mcp.scan(workspaceRoot);
  }

  async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
    const zen = window.zen;
    if (!zen?.mcp) {
      return;
    }
    // 条目来自 ref 深层响应式，是 Proxy；contextBridge 只收 structured-clone 可克隆的纯对象
    mcpStatuses.value = await zen.mcp.setServers(
      JSON.parse(JSON.stringify(servers)) as McpServerConfig[],
    );
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
    larkStatus,
    permissionMode,
    permissionLabel,
    bootstrap,
    updateSettings,
    refreshSkills,
    refreshMcp,
    authorizeMcp,
    refreshLark,
    scanMcp,
    saveMcpServers,
    pickDirectory,
    rebuildSandbox,
    syncUpload,
    syncDownload,
  };
});
