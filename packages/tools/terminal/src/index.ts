import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { TerminalFontSettings, TerminalShellInfo } from "@zen/shared";

export function createTerminalToolPlaceholder(): string {
  return "terminal";
}

/** 解析系统默认登录 shell（优先 $SHELL / COMSPEC，三方系统均可用） */
export function resolveDefaultShell(env: NodeJS.ProcessEnv = process.env): TerminalShellInfo {
  if (process.platform === "win32") {
    const comspec = env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    return {
      path: comspec,
      args: [],
      label: "Command Prompt",
      source: env.COMSPEC ? "env" : "fallback",
    };
  }

  const shell = env.SHELL?.trim();
  if (shell) {
    const name = shell.split("/").pop() || shell;
    return {
      path: shell,
      // 登录 shell，加载用户 profile（nvm/homebrew 等）；Linux/macOS 一致
      args: ["-l"],
      label: name,
      source: "env",
    };
  }

  const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return {
    path: fallback,
    args: ["-l"],
    label: fallback.split("/").pop() || fallback,
    source: "fallback",
  };
}

/** Nerd Font / Powerline 常见族名：保证 git/powerline/oh-my-posh 图标可渲染 */
const NERD_FONT_FALLBACKS = [
  "MesloLGS NF",
  "MesloLGS-NF",
  "0xProto Nerd Font",
  "0xProto Nerd Font Mono",
  "Hack Nerd Font",
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Cascadia Mono",
  "Cascadia Code",
  "DejaVu Sans Mono for Powerline",
  "Meslo LG M for Powerline",
];

const GENERIC_MONO_FALLBACKS = [
  "SF Mono",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  "Liberation Mono",
  "Courier New",
  "monospace",
];

const NERD_HINT = /(nerd|nf|powerline|meslo|hack|jetbrains|fira.?code|0xproto|caskaydia|cascadia)/i;

type FontSource = TerminalFontSettings["source"];
type PickedFont = { family: string; size: number; source: FontSource };

/** PostScript / 配置名 → CSS font-family 名 */
export function normalizeFontFamilyName(raw: string): string {
  let name = raw.trim().replace(/^["']|["']$/g, "");
  if (!name) {
    return "";
  }
  name = name.replace(/\s+\d+(\.\d+)?$/, "");
  if (/meslo.*nf/i.test(name)) {
    return "MesloLGS NF";
  }
  if (/0xproto.*nerd.*mono/i.test(name)) {
    return "0xProto Nerd Font Mono";
  }
  if (/0xproto.*nerd/i.test(name)) {
    return "0xProto Nerd Font";
  }
  if (/sfmono/i.test(name)) {
    return "SF Mono";
  }
  name = name.replace(/[- ]?(Regular|Medium|Bold|Italic|Light|SemiBold|BoldItalic|Oblique)$/i, "");
  name = name.replace(/-NF$/, "");
  return name.trim();
}

export function isNerdFontFamily(name: string): boolean {
  return NERD_HINT.test(name);
}

/** 拼接 CSS font-family：主字体在前，其后强制 Nerd Font 以补 icon 字形 */
export function buildTerminalFontFamily(primary: string): string {
  const families: string[] = [];
  const push = (item: string) => {
    const value = item.trim();
    if (!value) {
      return;
    }
    const quoted = /["']/.test(value) || value === "monospace" ? value : `"${value}"`;
    if (!families.includes(quoted)) {
      families.push(quoted);
    }
  };
  push(primary);
  for (const item of NERD_FONT_FALLBACKS) {
    push(item);
  }
  for (const item of GENERIC_MONO_FALLBACKS) {
    push(item);
  }
  return families.join(", ");
}

function readJsonSafe(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function envPath(...parts: string[]): string {
  return path.join(...parts.filter(Boolean));
}

/** VS Code / Cursor：三平台 settings.json 路径 */
function codeUserSettingsPaths(product: "Code" | "Cursor"): string[] {
  const home = homedir();
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const paths: string[] = [];
  if (process.platform === "darwin") {
    paths.push(envPath(home, "Library/Application Support", product, "User/settings.json"));
  } else if (process.platform === "win32") {
    if (appData) {
      paths.push(envPath(appData, product, "User/settings.json"));
    }
    // VS Code Insiders / 便携版常见变体
    if (product === "Code" && localAppData) {
      paths.push(envPath(localAppData, "Programs", "Microsoft VS Code", "resources/app/product.json"));
    }
  } else {
    // Linux
    paths.push(envPath(home, ".config", product, "User/settings.json"));
    // code-oss / vscodium 等
    if (product === "Code") {
      paths.push(envPath(home, ".config/Code - OSS/User/settings.json"));
      paths.push(envPath(home, ".config/VSCodium/User/settings.json"));
    }
  }
  return paths.filter((p) => p.endsWith("settings.json"));
}

function pickCodeTerminalFont(
  file: string,
): { family: string; size: number; source: "vscode" | "cursor" } | null {
  const json = readJsonSafe(file);
  if (!json) {
    return null;
  }
  const family =
    (typeof json["terminal.integrated.fontFamily"] === "string" &&
      json["terminal.integrated.fontFamily"]) ||
    "";
  const sizeRaw = json["terminal.integrated.fontSize"];
  const size = typeof sizeRaw === "number" && sizeRaw > 0 ? sizeRaw : 0;
  if (!family && !size) {
    return null;
  }
  return {
    family: normalizeFontFamilyName(family || "MesloLGS NF"),
    size: size || 14,
    source: /cursor/i.test(file) ? "cursor" : "vscode",
  };
}

function pickFirstCode(product: "Code" | "Cursor"): PickedFont | null {
  for (const file of codeUserSettingsPaths(product)) {
    if (!existsSync(file)) {
      continue;
    }
    const hit = pickCodeTerminalFont(file);
    if (hit) {
      return { family: hit.family, size: hit.size, source: hit.source };
    }
  }
  return null;
}

/** macOS iTerm2 */
function pickITermFont(): PickedFont | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const plist = path.join(homedir(), "Library/Preferences/com.googlecode.iterm2.plist");
  try {
    const out = execFileSync("plutil", ["-extract", "New Bookmarks", "json", "-o", "-", plist], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const bookmarks = JSON.parse(out) as Array<Record<string, unknown>>;
    const first = bookmarks?.[0];
    const normal = typeof first?.["Normal Font"] === "string" ? first["Normal Font"] : "";
    if (!normal) {
      return null;
    }
    const sizeMatch = /(\d+(?:\.\d+)?)\s*$/.exec(normal);
    return {
      family: normalizeFontFamilyName(normal),
      size: sizeMatch?.[1] ? Number(sizeMatch[1]) : 12,
      source: "iterm",
    };
  } catch {
    return null;
  }
}

/** macOS Terminal.app */
function pickTerminalAppFont(): PickedFont | null {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const out = execFileSync("defaults", ["export", "com.apple.Terminal", "-"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const nameHits =
      out.match(/(?:SFMono|Monaco|Menlo|Meslo|Hack|0xProto|Courier)[A-Za-z0-9 +_-]*/g) || [];
    const prefer = nameHits[0];
    if (!prefer) {
      return null;
    }
    return {
      family: normalizeFontFamilyName(prefer),
      size: 12,
      source: "terminal-app",
    };
  } catch {
    return null;
  }
}

/** Windows Terminal：%LOCALAPPDATA%\Packages\...\settings.json 等 */
function pickWindowsTerminalFont(): PickedFont | null {
  if (process.platform !== "win32") {
    return null;
  }
  const local = process.env.LOCALAPPDATA;
  if (!local) {
    return null;
  }
  const candidates = [
    // Store 版：包 ID 可能带哈希后缀
    ...((): string[] => {
      const pkgRoot = path.join(local, "Packages");
      if (!existsSync(pkgRoot)) {
        return [];
      }
      try {
        return readdirSync(pkgRoot)
          .filter((n) => n.startsWith("Microsoft.WindowsTerminal"))
          .map((n) => path.join(pkgRoot, n, "LocalState/settings.json"));
      } catch {
        return [];
      }
    })(),
    path.join(local, "Microsoft/Windows Terminal/settings.json"),
  ];

  for (const file of candidates) {
    const json = readJsonSafe(file);
    if (!json) {
      continue;
    }
    const profiles = json.profiles as Record<string, unknown> | undefined;
    const defaults = (profiles?.defaults ?? profiles) as Record<string, unknown> | undefined;
    const font = defaults?.font as Record<string, unknown> | string | undefined;
    const face =
      typeof font === "string"
        ? font
        : font && typeof font.face === "string"
          ? font.face
          : typeof defaults?.fontFace === "string"
            ? defaults.fontFace
            : "";
    const sizeRaw =
      font && typeof font === "object" && typeof font.size === "number" ? font.size : 12;
    if (!face) {
      continue;
    }
    return {
      family: normalizeFontFamilyName(face),
      size: sizeRaw > 0 ? sizeRaw : 12,
      source: "windows-terminal",
    };
  }
  return null;
}

function parseTomlOrYamlFont(text: string): { family: string; size: number } | null {
  // Alacritty TOML: [font] normal.family = "..." / size = 12
  const tomlFamily = /normal\s*=\s*\{[^}]*family\s*=\s*["']([^"']+)["']/s.exec(text)
    || /\[font\.normal\][\s\S]*?family\s*=\s*["']([^"']+)["']/i.exec(text);
  const tomlSize = /size\s*=\s*(\d+(?:\.\d+)?)/.exec(text);
  if (tomlFamily?.[1]) {
    return {
      family: normalizeFontFamilyName(tomlFamily[1]),
      size: tomlSize?.[1] ? Number(tomlSize[1]) : 12,
    };
  }
  // Alacritty YAML / 其它
  const ymlFamily = /font:\s*[\s\S]*?family:\s*["']?([^\n"']+)["']?/i.exec(text);
  if (ymlFamily?.[1]) {
    return {
      family: normalizeFontFamilyName(ymlFamily[1]),
      size: tomlSize?.[1] ? Number(tomlSize[1]) : 12,
    };
  }
  return null;
}

/** Linux Alacritty */
function pickAlacrittyFont(): PickedFont | null {
  if (process.platform !== "linux") {
    return null;
  }
  const home = homedir();
  const files = [
    path.join(home, ".config/alacritty/alacritty.toml"),
    path.join(home, ".config/alacritty/alacritty.yml"),
    path.join(home, ".alacritty.yml"),
  ];
  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }
    try {
      const hit = parseTomlOrYamlFont(readFileSync(file, "utf8"));
      if (hit?.family) {
        return { ...hit, source: "alacritty" };
      }
    } catch {
      // continue
    }
  }
  return null;
}

/** Linux kitty */
function pickKittyFont(): PickedFont | null {
  if (process.platform !== "linux") {
    return null;
  }
  const file = path.join(homedir(), ".config/kitty/kitty.conf");
  if (!existsSync(file)) {
    return null;
  }
  try {
    const text = readFileSync(file, "utf8");
    const family = /^\s*font_family\s+(.+)$/m.exec(text)?.[1]?.trim();
    const size = /^\s*font_size\s+(\d+(?:\.\d+)?)/m.exec(text)?.[1];
    if (!family) {
      return null;
    }
    return {
      family: normalizeFontFamilyName(family),
      size: size ? Number(size) : 12,
      source: "kitty",
    };
  } catch {
    return null;
  }
}

/**
 * 读取三方系统（macOS / Windows / Linux）终端字体设置，
 * 并拼出带 Nerd Font 回退的 fontFamily，保证 icon 正常。
 */
export function resolveSystemTerminalFont(): TerminalFontSettings {
  const candidates: PickedFont[] = [];
  const pushIf = (item: PickedFont | null) => {
    if (item?.family) {
      candidates.push(item);
    }
  };

  pushIf(pickFirstCode("Code"));
  pushIf(pickFirstCode("Cursor"));
  // macOS
  pushIf(pickITermFont());
  pushIf(pickTerminalAppFont());
  // Windows
  pushIf(pickWindowsTerminalFont());
  // Linux
  pushIf(pickAlacrittyFont());
  pushIf(pickKittyFont());

  const picked = candidates[0];
  const primary = picked?.family || "MesloLGS NF";
  const fontSize = picked?.size || 12;
  return {
    fontFamily: buildTerminalFontFamily(primary),
    fontSize,
    primaryFamily: primary,
    source: picked?.source || "fallback",
    isNerdFont: isNerdFontFamily(primary),
  };
}
