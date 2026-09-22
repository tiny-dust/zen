import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { app } from "electron";

import type { AgentSettings, McpServerConfig } from "@zen/shared";
import { DEFAULT_AGENT_SETTINGS } from "@zen/shared";

/**
 * ~/.zen 用户域目录（ADR-004）：技能、MCP、隔离区、agent 设置、本地加密密钥。
 * 凭据密文落 userData / SQLite，加密密钥为 ~/.zen/db/.secret-key（aes:v1，见 secret.ts）。
 */

export function zenRoot(): string {
  return join(homedir(), ".zen");
}

export function zenConfigFile(): string {
  return join(zenRoot(), "config.json");
}

export function zenMcpFile(): string {
  return join(zenRoot(), "mcp.json");
}

export function zenSandboxRoot(): string {
  return join(zenRoot(), "sandbox");
}

export function zenCacheRoot(): string {
  return join(zenRoot(), "cache");
}

export function zenSkillsRoot(): string {
  return join(zenRoot(), "skills");
}

export function zenMemoryDir(): string {
  return join(zenRoot(), "memory");
}

/** 应用域 userData（auth/settings/db），与 ~/.zen 分离 */
export function appDataDir(): string {
  return app.getPath("userData");
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export async function readMcpConfig(): Promise<{ servers: McpServerConfig[] }> {
  await ensureDir(zenRoot());
  try {
    const raw = await readFile(zenMcpFile(), "utf8");
    const parsed = JSON.parse(raw) as { servers?: McpServerConfig[] };
    return { servers: Array.isArray(parsed.servers) ? parsed.servers : [] };
  } catch {
    return { servers: [] };
  }
}

export async function writeMcpConfig(servers: McpServerConfig[]): Promise<void> {
  await ensureDir(zenRoot());
  await writeFile(zenMcpFile(), JSON.stringify({ servers }, null, 2), "utf8");
}

/** ~/.zen 布局初始化；返回缺省 agent 配置（不覆盖已有 config.json） */
export async function initZenDir(): Promise<void> {
  await Promise.all([
    ensureDir(zenRoot()),
    ensureDir(zenSkillsRoot()),
    ensureDir(zenSandboxRoot()),
    ensureDir(zenCacheRoot()),
    ensureDir(zenMemoryDir()),
  ]);
  const existing = await readJson<Partial<AgentSettings>>(zenConfigFile(), {});
  if (Object.keys(existing).length === 0) {
    await writeFile(zenConfigFile(), JSON.stringify(DEFAULT_AGENT_SETTINGS, null, 2), "utf8");
  }
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  await ensureDir(zenRoot());
  const stored = await readJson<Partial<AgentSettings>>(zenConfigFile(), DEFAULT_AGENT_SETTINGS);
  return {
    ...DEFAULT_AGENT_SETTINGS,
    ...stored,
    prompt: { ...DEFAULT_AGENT_SETTINGS.prompt, ...stored.prompt },
  };
}

export async function saveAgentSettings(partial: Partial<AgentSettings>): Promise<AgentSettings> {
  const current = await loadAgentSettings();
  const next: AgentSettings = { ...current, ...partial };
  await ensureDir(dirname(zenConfigFile()));
  await writeFile(zenConfigFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
