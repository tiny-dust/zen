import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 各 AI 工具 MCP 配置文件的候选路径（用户级 + 当前工作区项目级）。
 * 三平台按 process.platform 分支：mac ~/Library/Application Support、
 * Windows %APPDATA%/%USERPROFILE%、Linux ~/.config（XDG）；读不到的路径由扫描方静默跳过。
 */

export interface ScanContext {
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

export function defaultScanContext(): ScanContext {
  return { home: homedir(), platform: process.platform, env: process.env };
}

export type SourceFormat = "json" | "jsonc" | "toml";

export interface SourceCandidate {
  path: string;
  /** 来源工具展示名 */
  source: string;
  format: SourceFormat;
  /** JSON 内 server map 的定位路径；缺省 = mcpServers / servers / mcp / 顶层 */
  mapAt?: string[];
  scope: "user" | "project";
}

/** 桌面应用用户数据目录：mac ~/Library/Application Support｜win %APPDATA%｜linux ~/.config */
function userAppDataDir(ctx: ScanContext): string {
  if (ctx.platform === "darwin") {
    return join(ctx.home, "Library", "Application Support");
  }
  if (ctx.platform === "win32") {
    return ctx.env.APPDATA ?? join(ctx.home, "AppData", "Roaming");
  }
  return ctx.env.XDG_CONFIG_HOME ?? join(ctx.home, ".config");
}

/** XDG 配置目录（MiMoCode 等 CLI 全平台 ~/.config 风格；Linux 尊重 XDG_CONFIG_HOME） */
function xdgConfigDir(ctx: ScanContext): string {
  return ctx.env.XDG_CONFIG_HOME ?? join(ctx.home, ".config");
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** VS Code 系（稳定版 / Insiders）：User/mcp.json 与 User/profiles/<id>/mcp.json */
function vscodeCandidates(ctx: ScanContext, appData: string): SourceCandidate[] {
  const list: SourceCandidate[] = [];
  const families: Array<[string, string]> = [
    ["Code", "VS Code"],
    ["Code - Insiders", "VS Code Insiders"],
  ];
  for (const [dirName, label] of families) {
    const userDir = join(appData, dirName, "User");
    list.push({ path: join(userDir, "mcp.json"), source: label, format: "json", scope: "user" });
    // settings.json 里的 "mcp": { name: {...} }（JSONC，带注释/尾逗号）
    list.push({
      path: join(userDir, "settings.json"),
      source: `${label} settings`,
      format: "jsonc",
      mapAt: ["mcp"],
      scope: "user",
    });
    for (const profile of safeReaddir(join(userDir, "profiles"))) {
      list.push({
        path: join(userDir, "profiles", profile, "mcp.json"),
        source: `${label}（配置文件）`,
        format: "json",
        scope: "user",
      });
    }
  }
  return list;
}

/** MiMo（MiMoCode）：JSONC 的顶层 "mcp" 键；全局在 mimocode 配置目录，Windows 兼容 %APPDATA% */
function mimoCandidates(ctx: ScanContext, appData: string): SourceCandidate[] {
  const dirs = new Set<string>([
    join(xdgConfigDir(ctx), "mimocode"),
    join(ctx.home, ".config", "mimocode"),
  ]);
  if (ctx.platform === "win32") {
    dirs.add(join(appData, "mimocode"));
  }
  const list: SourceCandidate[] = [];
  for (const dir of dirs) {
    for (const file of ["mimocode.jsonc", "mimocode.json", "config.json"]) {
      list.push({
        path: join(dir, file),
        source: "MiMo",
        format: "jsonc",
        mapAt: ["mcp"],
        scope: "user",
      });
    }
  }
  return list;
}

/** 按平台列出候选配置文件（用户级 + 当前工作区项目级） */
export function buildCandidates(ctx: ScanContext, workspaceRoot?: string): SourceCandidate[] {
  const appData = userAppDataDir(ctx);
  const list: SourceCandidate[] = [];
  const codexHome = ctx.env.CODEX_HOME ?? join(ctx.home, ".codex");

  // —— 用户级 —— //
  list.push({
    path: join(codexHome, "config.toml"),
    source: "OpenAI Codex CLI",
    format: "toml",
    mapAt: ["mcp_servers"],
    scope: "user",
  });
  list.push({
    path: join(ctx.home, ".claude.json"),
    source: "Claude Code",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });
  list.push({
    path: join(appData, "Claude", "claude_desktop_config.json"),
    source: "Claude Desktop",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });
  list.push({
    path: join(ctx.home, ".cursor", "mcp.json"),
    source: "Cursor",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });
  list.push(...vscodeCandidates(ctx, appData));
  list.push({
    path: join(ctx.home, ".codeium", "windsurf", "mcp_config.json"),
    source: "Windsurf",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });
  for (const dirName of ["Trae", "Trae CN"]) {
    list.push({
      path: join(appData, dirName, "User", "mcp.json"),
      source: "Trae",
      format: "json",
      scope: "user",
    });
  }
  list.push({
    path: join(ctx.home, ".gemini", "settings.json"),
    source: "Gemini CLI",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });
  list.push(...mimoCandidates(ctx, appData));
  list.push({
    path: join(ctx.home, ".dimcode", "v2", "mcp.json"),
    source: "DimAgent",
    format: "json",
    mapAt: ["mcpServers"],
    scope: "user",
  });

  // —— 当前工作区项目级 —— //
  if (workspaceRoot) {
    list.push({
      path: join(workspaceRoot, ".mcp.json"),
      source: "当前仓库 (.mcp.json)",
      format: "json",
      scope: "project",
    });
    // Claude Code 项目级（local scope）也存于 ~/.claude.json 的 projects.<路径>.mcpServers
    list.push({
      path: join(ctx.home, ".claude.json"),
      source: "Claude Code（本项目）",
      format: "json",
      mapAt: ["projects", workspaceRoot, "mcpServers"],
      scope: "project",
    });
    list.push({
      path: join(workspaceRoot, ".cursor", "mcp.json"),
      source: "当前仓库 (.cursor/mcp.json)",
      format: "json",
      mapAt: ["mcpServers"],
      scope: "project",
    });
    list.push({
      path: join(workspaceRoot, ".vscode", "mcp.json"),
      source: "当前仓库 (.vscode/mcp.json)",
      format: "json",
      scope: "project",
    });
    list.push({
      path: join(workspaceRoot, ".gemini", "settings.json"),
      source: "当前仓库 (.gemini/settings.json)",
      format: "json",
      mapAt: ["mcpServers"],
      scope: "project",
    });
    for (const file of ["mimocode.jsonc", "mimocode.json"]) {
      list.push({
        path: join(workspaceRoot, ".mimocode", file),
        source: "当前仓库 (.mimocode)",
        format: "jsonc",
        mapAt: ["mcp"],
        scope: "project",
      });
    }
  }
  return list;
}
