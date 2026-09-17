import { BrowserWindow, ipcMain } from "electron";

import {
  addModel,
  addProvider,
  listProviders,
  removeModel,
  updateModel,
  updateProvider,
} from "./model-db";
import { getStoredAuthTokens } from "./user-ipc";
import { loadAgentSettings, readMcpConfig, saveAgentSettings, writeMcpConfig } from "./zen-dir";

import type {
  AgentSettings,
  McpServerConfig,
  ProviderModel,
  ProviderSummary,
  SyncResult,
} from "@zen/shared";

/**
 * 配置云同步（GitHub 私密仓库）：
 * - 导出内容 = 供应器/模型元数据 + agent 设置 + MCP 配置。**不含任何 API Key**。
 * - 仓库：设置里的 syncRepo（缺省 zen-config），不存在时尝试创建（private）。
 * - 需要仓库写权限的 token：登录 scope 必须包含 repo（见 docs/auth/github-oauth-setup.md）。
 */

interface SyncPayload {
  version: 1;
  exportedAt: number;
  providers: Array<{
    id: string;
    name: string;
    protocol: ProviderSummary["protocol"];
    baseUrl: string;
    userAgent?: string;
    enabled: boolean;
    models: ProviderModel[];
  }>;
  agentSettings: AgentSettings;
  mcpServers: McpServerConfig[];
}

const GITHUB_API = "https://api.github.com";

function zenHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "zen-desktop",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function ensureRepo(token: string, login: string, repoName: string): Promise<string> {
  const check = await fetch(`${GITHUB_API}/repos/${login}/${repoName}`, {
    headers: zenHeaders(token),
  });
  if (check.ok) {
    return `${login}/${repoName}`;
  }
  const created = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: zenHeaders(token),
    body: JSON.stringify({ name: repoName, private: true, auto_init: false }),
  });
  if (!created.ok) {
    const detail = await created.text();
    throw new Error(`创建同步仓库失败（HTTP ${created.status}）：${detail.slice(0, 200)}`);
  }
  return `${login}/${repoName}`;
}

async function getLogin(token: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/user`, { headers: zenHeaders(token) });
  if (!response.ok) {
    throw new Error(`获取 GitHub 身份失败（HTTP ${response.status}）`);
  }
  const data = (await response.json()) as { login: string };
  return data.login;
}

async function buildPayload(): Promise<SyncPayload> {
  const providers = await listProviders();
  const agentSettings = await loadAgentSettings();
  const { servers } = await readMcpConfig();
  return {
    version: 1,
    exportedAt: Date.now(),
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      userAgent: provider.userAgent,
      enabled: provider.enabled,
      models: provider.models,
    })),
    agentSettings,
    mcpServers: servers,
  };
}

async function putConfigFile(
  token: string,
  repo: string,
  payload: SyncPayload,
): Promise<void> {
  const path = "zen-config.json";
  let sha: string | undefined;
  const existing = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: zenHeaders(token),
  });
  if (existing.ok) {
    sha = ((await existing.json()) as { sha?: string }).sha;
  }
  const content = Buffer.from(JSON.stringify(payload, null, 2), "utf8").toString("base64");
  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: zenHeaders(token),
    body: JSON.stringify({
      message: `zen config sync ${new Date().toISOString()}`,
      content,
      sha,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`上传配置失败（HTTP ${response.status}）：${detail.slice(0, 200)}`);
  }
}

async function fetchConfigFile(token: string, repo: string): Promise<SyncPayload> {
  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/zen-config.json`, {
    headers: zenHeaders(token),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "同步仓库里还没有 zen-config.json，请先在其他设备上传"
        : `下载配置失败（HTTP ${response.status}）`,
    );
  }
  const data = (await response.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") {
    throw new Error("同步文件格式异常");
  }
  return JSON.parse(Buffer.from(data.content, "base64").toString("utf8")) as SyncPayload;
}

/** 导入合并：provider 按 id 更新/新建；agent 设置与 MCP 以云端为准 */
async function applyPayload(payload: SyncPayload): Promise<string> {
  let providerCount = 0;
  let modelCount = 0;
  for (const remote of payload.providers ?? []) {
    const existing = (await listProviders()).find((item) => item.id === remote.id);
    if (existing) {
      await updateProvider(remote.id, {
        name: remote.name,
        protocol: remote.protocol,
        baseUrl: remote.baseUrl,
        userAgent: remote.userAgent,
        enabled: remote.enabled,
      });
    } else {
      await addProvider({
        name: remote.name,
        protocol: remote.protocol,
        baseUrl: remote.baseUrl,
        userAgent: remote.userAgent,
        enabled: remote.enabled,
      });
    }
    providerCount += 1;

    const provider = (await listProviders()).find((item) => item.name === remote.name);
    if (!provider) {
      continue;
    }
    const localIds = new Set(provider.models.map((item) => item.id));
    for (const model of remote.models ?? []) {
      if (localIds.has(model.id)) {
        await updateModel({
          providerId: provider.id,
          id: model.id,
          name: model.name,
          enabled: model.enabled,
          capabilities: model.capabilities,
        });
      } else {
        await addModel({
          providerId: provider.id,
          id: model.id,
          name: model.name,
          enabled: model.enabled,
          capabilities: model.capabilities,
        });
      }
      modelCount += 1;
    }
    for (const local of provider.models) {
      if (!(remote.models ?? []).some((item) => item.id === local.id)) {
        await removeModel(provider.id, local.id);
      }
    }
  }
  if (payload.agentSettings) {
    await saveAgentSettings(payload.agentSettings);
  }
  if (Array.isArray(payload.mcpServers)) {
    await writeMcpConfig(payload.mcpServers);
  }
  return `${providerCount} 个供应器 / ${modelCount} 个模型`;
}

async function withToken(repoName: string): Promise<{ token: string; repo: string }> {
  const token = await getStoredAuthTokens();
  if (!token) {
    throw new Error("未登录 GitHub，无法同步配置");
  }
  const login = await getLogin(token);
  const repo = await ensureRepo(token, login, repoName || "zen-config");
  return { token, repo };
}

export function registerSyncIpc(): void {
  ipcMain.handle("sync:upload", async (): Promise<SyncResult> => {
    try {
      const settings = await loadAgentSettings();
      if (!settings.syncEnabled) {
        return { ok: false, error: "配置云同步未开启，请在设置中开启后重试" };
      }
      const { token, repo } = await withToken(settings.syncRepo ?? "zen-config");
      const payload = await buildPayload();
      await putConfigFile(token, repo, payload);
      return { ok: true, repo, summary: `${payload.providers.length} 个供应器` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("sync:download", async (): Promise<SyncResult> => {
    try {
      const settings = await loadAgentSettings();
      if (!settings.syncEnabled) {
        return { ok: false, error: "配置云同步未开启，请在设置中开启后重试" };
      }
      const { token, repo } = await withToken(settings.syncRepo ?? "zen-config");
      const payload = await fetchConfigFile(token, repo);
      const summary = await applyPayload(payload);
      broadcastAgentSettings(await loadAgentSettings());
      return { ok: true, repo, summary };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function broadcastAgentSettings(settings: AgentSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("agent:settings-changed", settings);
    }
  }
}
