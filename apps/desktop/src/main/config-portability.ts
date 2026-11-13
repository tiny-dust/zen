import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

import { app } from "electron";

import type { AgentSettings, AppSettings, ModelCapabilities, ProviderProtocol } from "@zen/shared";

import { getDb } from "./model-db-connection";
import { listProviders } from "./model-db";
import { loadAgentSettings, loadBrowserSettings, readMcpConfig, saveAgentSettings, saveBrowserSettings, writeMcpConfig, zenConfigFile } from "./zen-dir";
import { loadAppSettings } from "./user-ipc";

const scrypt = promisify(scryptCallback);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const GROUPS = ["models", "agent", "browser", "mcp", "ui"] as const;
export type PortabilityGroup = (typeof GROUPS)[number];

interface ModelEntry {
  id: string;
  name: string;
  enabled: boolean;
  custom: boolean;
  capabilities?: ModelCapabilities;
}
interface ProviderEntry {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  models: ModelEntry[];
}
interface SafeAgent {
  permissionMode: "default" | "smart";
  sandboxMode: AgentSettings["sandboxMode"];
  promptPresetId: string;
  promptVersion: "distilled" | "zh" | "en";
  cuaEnabled: boolean;
  approvalReviewer: "off" | "assistant";
}
interface SafeUi {
  theme: AppSettings["theme"];
  accentColor: AppSettings["accentColor"];
  locale: AppSettings["locale"];
  codeTheme: string;
  displayAccount: AppSettings["displayAccount"];
}
interface PortabilityPayload {
  version: 1;
  exportedAt: number;
  models: ProviderEntry[];
  agent: SafeAgent;
  browser: { zoomPercent: number; autoFillPasswords: boolean };
  mcp: Array<{ id: string; name: string; transport: "stdio" | "sse" | "http" }>;
  ui: SafeUi;
}
interface EncryptedFile {
  format: "zen-config-encrypted";
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeText(value: unknown, limit = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit &&
    !/[\x00-\x1f]/.test(value) && !/(?:bearer\s|sk-[a-z0-9]{12}|gh[puosr]_[a-z0-9]{12}|api[_-]?key\s*[:=])/i.test(value);
}
function safeId(value: unknown): value is string {
  return safeText(value, 150) && /^[\w.\-/:]+$/.test(value);
}
function portableBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 300) return "";
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /^(localhost|127\.|\[::1\])/.test(url.hostname) || !/^[\w/.-]*$/.test(url.pathname)) return "";
    return url.toString();
  } catch { return ""; }
}
function safeModel(value: unknown): value is ModelEntry {
  if (!record(value) || !safeId(value.id) || !safeText(value.name) ||
      typeof value.enabled !== "boolean" || typeof value.custom !== "boolean") return false;
  if (!Object.keys(value).every((key) => ["id", "name", "enabled", "custom", "capabilities"].includes(key))) return false;
  if (value.capabilities === undefined) return true;
  if (!record(value.capabilities)) return false;
  return Object.entries(value.capabilities).every(([key, part]) => {
    if (["reasoning", "vision", "toolCall", "media", "imageEdit"].includes(key)) return typeof part === "boolean";
    if (["contextWindow", "maxOutputTokens"].includes(key)) return Number.isSafeInteger(part) && Number(part) >= 0;
    if (key === "reasoningEfforts") return Array.isArray(part) && part.length <= 7 && part.every((item) =>
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(item));
    if (key === "chatEndpoint") return ["auto", "openai-chat", "openai-responses", "anthropic-messages"].includes(String(part));
    if (key === "source") return ["catalog", "api", "heuristic", "manual"].includes(String(part));
    return false;
  });
}
function validPayload(value: unknown): value is PortabilityPayload {
  if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.exportedAt) ||
      !Array.isArray(value.models) || value.models.length > 200 ||
      !Array.isArray(value.mcp) || value.mcp.length > 200 ||
      !record(value.agent) || !record(value.browser) || !record(value.ui)) return false;
  const agent = value.agent;
  const browser = value.browser;
  const ui = value.ui;
  return value.models.every((provider: unknown) => record(provider) && safeId(provider.id) &&
    safeText(provider.name) && ["openai-chat", "openai-responses", "anthropic-messages"].includes(String(provider.protocol)) &&
    typeof provider.baseUrl === "string" && (provider.baseUrl === "" || portableBaseUrl(provider.baseUrl) === provider.baseUrl) &&
    Object.keys(provider).every((key) => ["id", "name", "protocol", "baseUrl", "models"].includes(key)) &&
    Array.isArray(provider.models) && provider.models.length <= 1000 && provider.models.every(safeModel)) &&
    value.mcp.every((server: unknown) => record(server) && safeId(server.id) && safeText(server.name) &&
      ["stdio", "sse", "http"].includes(String(server.transport)) && Object.keys(server).every((key) => ["id", "name", "transport"].includes(key))) &&
    ["default", "smart"].includes(String(agent.permissionMode)) &&
    ["direct", "isolated"].includes(String(agent.sandboxMode)) &&
    typeof agent.cuaEnabled === "boolean" && ["off", "assistant"].includes(String(agent.approvalReviewer)) &&
    safeId(agent.promptPresetId) && ["distilled", "zh", "en"].includes(String(agent.promptVersion)) &&
    Number.isInteger(browser.zoomPercent) && Number(browser.zoomPercent) >= 50 && Number(browser.zoomPercent) <= 300 &&
    typeof browser.autoFillPasswords === "boolean" &&
    ["dark", "light", "system"].includes(String(ui.theme)) &&
    ["orange", "blue", "purple", "red", "green", "cyan"].includes(String(ui.accentColor)) &&
    ["zh-CN", "en-US"].includes(String(ui.locale)) && safeId(ui.codeTheme) &&
    ["auto", "github", "lark"].includes(String(ui.displayAccount)) &&
    Object.keys(value).every((key) => ["version", "exportedAt", ...GROUPS].includes(key)) &&
    Object.keys(agent).every((key) => ["permissionMode", "sandboxMode", "promptPresetId", "promptVersion", "cuaEnabled", "approvalReviewer"].includes(key)) &&
    Object.keys(browser).every((key) => ["zoomPercent", "autoFillPasswords"].includes(key)) &&
    Object.keys(ui).every((key) => ["theme", "accentColor", "locale", "codeTheme", "displayAccount"].includes(key));
}

async function collectPayload(): Promise<PortabilityPayload> {
  const [providers, agent, browser, mcp, ui] = await Promise.all([
    listProviders(), loadAgentSettings(), loadBrowserSettings(), readMcpConfig(), loadAppSettings(),
  ]);
  const payload: PortabilityPayload = {
    version: 1,
    exportedAt: Date.now(),
    models: providers.map((provider) => ({
      id: provider.id, name: provider.name, protocol: provider.protocol,
      baseUrl: portableBaseUrl(provider.baseUrl),
      models: provider.models.map((model) => ({
        id: model.id, name: model.name, enabled: model.enabled, custom: model.custom === true,
        ...(model.capabilities ? { capabilities: model.capabilities } : {}),
      })),
    })),
    agent: {
      permissionMode: agent.permissionMode === "default" ? "default" : "smart",
      sandboxMode: agent.sandboxMode,
      promptPresetId: agent.prompt.presetId === "custom" ? "zen-default" : agent.prompt.presetId,
      promptVersion: agent.prompt.version === "zh" || agent.prompt.version === "en" ? agent.prompt.version : "distilled",
      cuaEnabled: agent.cuaEnabled === true,
      approvalReviewer: agent.approvalReviewer === "assistant" ? "assistant" : "off",
    },
    browser: { zoomPercent: browser.zoomPercent, autoFillPasswords: browser.autoFillPasswords },
    // MCP 连接字段可能含任意密钥：只导出禁用的定义，不导出 command/args/env/url/headers。
    mcp: mcp.servers.map((server) => ({ id: server.id, name: server.name, transport: server.transport })),
    ui: {
      theme: ui.theme, accentColor: ui.accentColor, locale: ui.locale,
      codeTheme: ui.codeTheme, displayAccount: ui.displayAccount,
    },
  };
  if (!validPayload(payload)) throw new Error("配置包含不安全或不支持的元数据，已取消导出");
  return payload;
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, 32)) as Buffer;
}

/** 创建独立的本地加密文件；不覆盖目标文件。密码只用于本次加解密，不持久化。 */
export async function exportConfigFile(path: string, password: string): Promise<void> {
  if (typeof password !== "string" || password.length < 12) throw new Error("导出密码至少 12 个字符");
  const payload = await collectPayload();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(password, salt), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const encrypted: EncryptedFile = {
    format: "zen-config-encrypted", version: 1, kdf: "scrypt", cipher: "aes-256-gcm",
    salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"),
  };
  await writeFile(path, JSON.stringify(encrypted), { flag: "wx", mode: 0o600 });
}

async function readPayload(path: string, password: string): Promise<PortabilityPayload> {
  if (typeof password !== "string" || !password) throw new Error("请输入导入密码");
  if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error("配置文件过大");
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("配置文件过大");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("配置文件格式无效"); }
  if (!record(parsed) || parsed.format !== "zen-config-encrypted" || parsed.version !== 1 ||
      parsed.kdf !== "scrypt" || parsed.cipher !== "aes-256-gcm" ||
      !["salt", "iv", "tag", "data"].every((key) => typeof parsed[key] === "string")) {
    throw new Error("配置文件格式无效");
  }
  const decode = (key: string) => Buffer.from(parsed[key] as string, "base64");
  const salt = decode("salt"), iv = decode("iv"), tag = decode("tag");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error("配置文件格式无效");
  try {
    const decipher = createDecipheriv("aes-256-gcm", await deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(decode("data")), decipher.final()]).toString("utf8");
    const payload: unknown = JSON.parse(plaintext);
    if (!validPayload(payload)) throw new Error("invalid payload");
    return payload;
  } catch {
    throw new Error("密码错误或配置文件已损坏/包含不安全字段");
  }
}

async function existingGroups(): Promise<Record<PortabilityGroup, number>> {
  const [providers, mcp] = await Promise.all([listProviders(), readMcpConfig()]);
  const exists = async (path: string) => stat(path).then(() => 1, () => 0);
  return {
    models: providers.length,
    agent: await exists(zenConfigFile()),
    browser: await exists(zenConfigFile()),
    mcp: mcp.servers.length,
    ui: await exists(join(app.getPath("userData"), "settings.json")),
  };
}

/** 只返回分组数量和冲突数，不将解密后的设置或凭据送给渲染进程。 */
export async function previewConfigFile(path: string, password: string): Promise<{
  exportedAt: number;
  groups: Record<PortabilityGroup, { incoming: number; existing: number }>;
}> {
  const payload = await readPayload(path, password);
  const existing = await existingGroups();
  return {
    exportedAt: payload.exportedAt,
    groups: {
      models: { incoming: payload.models.length, existing: existing.models },
      agent: { incoming: 1, existing: existing.agent },
      browser: { incoming: 1, existing: existing.browser },
      mcp: { incoming: payload.mcp.length, existing: existing.mcp },
      ui: { incoming: 1, existing: existing.ui },
    },
  };
}

/** 默认只补充缺失项；overwrite=true 才更新选中分组的现有设置/模型。 */
export async function importConfigFile(path: string, password: string, options: {
  groups: PortabilityGroup[];
  overwrite?: boolean;
}): Promise<Record<PortabilityGroup, number>> {
  const payload = await readPayload(path, password);
  if (!Array.isArray(options?.groups) || options.groups.some((group) => !GROUPS.includes(group))) {
    throw new Error("导入分组无效");
  }
  const selected = new Set(options.groups);
  const overwrite = options.overwrite === true;
  const counts = { models: 0, agent: 0, browser: 0, mcp: 0, ui: 0 };
  const existingGroupsBeforeImport = await existingGroups();
  if (selected.has("models")) {
    const db = getDb();
    const existing = await listProviders();
    const now = Date.now();
    // 缺少 API Key 的供应商只能以禁用状态导入，由用户在本机填写密钥后启用。
    db.transaction(() => {
      const providerInsert = db.prepare(`INSERT OR IGNORE INTO model_providers
        (id, name, protocol, base_url, api_key_enc, api_key_mask, auth_mode, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', '', 'api-key', 0, ?, ?)`);
      const modelInsert = db.prepare(`INSERT INTO provider_models
        (provider_id, id, name, enabled, custom, capabilities_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, id) DO NOTHING`);
      const modelUpdate = db.prepare(`UPDATE provider_models SET name = ?, enabled = ?, custom = ?, capabilities_json = ?, updated_at = ?
        WHERE provider_id = ? AND id = ?`);
      for (const provider of payload.models) {
        const local = existing.find((item) => item.id === provider.id);
        if (local && overwrite) {
          db.prepare("UPDATE model_providers SET name = ?, protocol = ?, updated_at = ? WHERE id = ?")
            .run(provider.name, provider.protocol, now, provider.id);
        } else if (!local) {
          providerInsert.run(provider.id, provider.name, provider.protocol, provider.baseUrl, now, now);
          counts.models += 1;
        }
        const localIds = new Set(local?.models.map((model) => model.id) ?? []);
        for (const model of provider.models) {
          const capabilities = model.capabilities ? JSON.stringify(model.capabilities) : null;
          if (localIds.has(model.id)) {
            if (overwrite) modelUpdate.run(model.name, model.enabled ? 1 : 0, model.custom ? 1 : 0, capabilities, now, provider.id, model.id);
          } else {
            modelInsert.run(provider.id, model.id, model.name, local ? (model.enabled ? 1 : 0) : 0,
              model.custom ? 1 : 0, capabilities, now, now);
            counts.models += 1;
          }
        }
      }
    })();
  }
  if (selected.has("agent") && (overwrite || !existingGroupsBeforeImport.agent)) {
    await saveAgentSettings({
      permissionMode: payload.agent.permissionMode,
      sandboxMode: payload.agent.sandboxMode,
      cuaEnabled: payload.agent.cuaEnabled,
      approvalReviewer: payload.agent.approvalReviewer,
      prompt: { ...(await loadAgentSettings()).prompt, presetId: payload.agent.promptPresetId, version: payload.agent.promptVersion },
    });
    counts.agent = 1;
  }
  if (selected.has("browser") && (overwrite || !existingGroupsBeforeImport.browser)) {
    await saveBrowserSettings(payload.browser);
    counts.browser = 1;
  }
  if (selected.has("mcp")) {
    const { servers } = await readMcpConfig();
    const ids = new Set(servers.map((item) => item.id));
    const additions = payload.mcp.filter((item) => !ids.has(item.id)).map((item) => ({ ...item, enabled: false }));
    if (additions.length) await writeMcpConfig([...servers, ...additions]);
    counts.mcp = additions.length;
  }
  if (selected.has("ui") && (overwrite || !existingGroupsBeforeImport.ui)) {
    // user-ipc 的设置缓存在内存中；当前仅写文件，重启后由正常启动流程应用主题和快捷键。
    const file = join(app.getPath("userData"), "settings.json");
    const current = await loadAppSettings();
    await writeFile(file, JSON.stringify({ ...current, ...payload.ui }, null, 2), "utf8");
    counts.ui = 1;
  }
  return counts;
}
