import { isCustomThemeId, normalizeCustomTheme } from "../theme/custom";

import type { CustomTheme } from "../theme/custom";

export interface GitHubUser {
  login: string;
  name: string;
  avatarUrl: string;
  htmlUrl: string;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  email?: string | null;
  followers?: number;
  following?: number;
  publicRepos?: number;
  publicGists?: number;
  updatedAt?: string | null;
}

/**
 * 界面主题：system = 跟随操作系统深浅色；其余为内置预设（对照 nomi 的七套配色）。
 * 预设只管底色与文字层级，强调色仍由 accentColor 独立决定。
 */
export type ThemeMode = "light" | "dark" | "system" | "mist" | "graphite" | "ink" | "cream" | "sunset";

/** 固定预设（不含 system）：顺序即设置页排列 */
export const THEME_PRESETS = ["light", "dark", "mist", "graphite", "ink", "cream", "sunset"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

/** 深色基底预设：原生窗口外观与 .dark 类据此判断 */
const DARK_PRESETS = new Set<string>(["dark", "graphite", "ink", "sunset"]);

export interface ThemePresetInfo {
  id: ThemePreset;
  /** 预览色卡：背景 / 表面 / 文字 / 强调，与设置页色块同序 */
  swatch: readonly [string, string, string, string];
  dark: boolean;
}

export const THEME_PRESET_INFO: readonly ThemePresetInfo[] = [
  { id: "light", swatch: ["#faf9f6", "#faf9f6", "#211d19", "#9d3f29"], dark: false },
  { id: "dark", swatch: ["#13161b", "#13161b", "#f7f9fc", "#ff6a2b"], dark: true },
  { id: "mist", swatch: ["#eef1f5", "#ffffff", "#16202a", "#2f6fb3"], dark: false },
  { id: "graphite", swatch: ["#1b1c20", "#24262b", "#eceef2", "#8f96a3"], dark: true },
  { id: "ink", swatch: ["#0a0a0b", "#141416", "#f7f7f8", "#c9cdd6"], dark: true },
  { id: "cream", swatch: ["#f7f0e3", "#fffaf2", "#2a241d", "#a8622a"], dark: false },
  { id: "sunset", swatch: ["#1d1512", "#271c17", "#f6ece4", "#e98a4f"], dark: true },
];

export const THEME_MODES: readonly ThemeMode[] = [...THEME_PRESETS, "system"];

/** 用户可选的主题：内置预设 / 跟随系统 / 自定义主题 custom:<id> */
export type ThemeSelection = ThemeMode | `custom:${string}`;

/** 非法/旧值回退：只有 system 与内置预设算合法 */
export function normalizeTheme(value: unknown): ThemeMode {
  return THEME_MODES.find((mode) => mode === value) ?? DEFAULT_THEME;
}

/** 主题选择归一：预设 / system / custom:<合法 id>；其余回退默认预设 */
export function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (typeof value === "string" && value.startsWith("custom:") && isCustomThemeId(value.slice(7))) {
    return value as ThemeSelection;
  }
  return normalizeTheme(value);
}

/** 该系统外观下实际渲染的预设（system 解析成 light / dark） */
export function resolveThemePreset(theme: ThemeMode, systemDark: boolean): ThemePreset {
  if (theme === "system") {
    return systemDark ? "dark" : "light";
  }
  return theme;
}

export function isDarkPreset(theme: ThemeMode, systemDark = false): boolean {
  return DARK_PRESETS.has(resolveThemePreset(theme, systemDark));
}

/** 全局强调色；语义状态色（成功、危险等）不随之变化。 */
export type AccentColor = "nomi" | "orange" | "blue" | "purple" | "red" | "green" | "cyan";

/** 界面语言 */
export type AppLocale = "zh-CN" | "en-US";

/** 左下角/资料页展示哪个账户的身份：auto = GitHub 优先、无 GitHub 用飞书 */
export type DisplayAccount = "auto" | "github" | "lark";

export interface ShortcutBinding {
  id: string;
  label: string;
  command: string;
  key: string;
  when?: string;
  /**
   * 应用级（系统全局）注册：true 时主进程把该快捷键注册到 OS 全局快捷键表，
   * 其它应用聚焦时也能触发（拉起 Zen 窗口并执行命令）。
   * 仅 GLOBAL_SHORTCUT_COMMANDS 白名单内的命令允许开启。
   */
  global?: boolean;
}

/** 阶段模型引用（供应商 + 模型）；用于全局 Plan/Act 默认与设置页展示 */
export interface PhaseModelRef {
  providerId: string;
  modelId: string;
}

/**
 * 图片背景（只作用于聊天内容区，不影响顶栏/侧栏/右栏）。
 * 图片文件存在 userData/theme-images 下，settings.json 只存文件名与显示参数。
 */
export interface ThemeImageSettings {
  /** 已保存背景图的文件名；空串表示没有图 */
  id: string;
  /** 是否启用；关闭后回到当前配色，不动已保存的主题选择 */
  enabled: boolean;
  /** 模糊半径 px（0-40）：越大越不抢文字 */
  blur: number;
  /** 遮罩不透明度（0-0.9）：保证图片上的文字可读 */
  dim: number;
}

export const MAX_THEME_IMAGE_BYTES = 12 * 1024 * 1024;
export const THEME_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export interface ThemeImagePickResult {
  ok: boolean;
  /** 用户取消不算失败：界面不应提示错误 */
  canceled?: boolean;
  id?: string;
  /** 失败原因码：too-large / unsupported-format / not-a-file，界面据此给文案 */
  error?: string;
}

export const DEFAULT_THEME_IMAGE: ThemeImageSettings = {
  id: "",
  enabled: false,
  blur: 0,
  dim: 0.45,
};

/** 文件名白名单：只接受「随机名.允许的后缀」，渲染层无法借此读任意路径 */
export function isValidThemeImageId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]{8,64}\.(png|jpg|jpeg|webp)$/i.test(id);
}

export function normalizeThemeImage(value: unknown): ThemeImageSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_THEME_IMAGE };
  }
  const raw = value as Partial<ThemeImageSettings>;
  const id = isValidThemeImageId(raw.id) ? raw.id : "";
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  return {
    id,
    // 没有可用图片时不允许「启用」，避免空背景挡住聊天气泡
    enabled: Boolean(raw.enabled) && Boolean(id),
    blur: Math.round(clamp(raw.blur, 0, 40, DEFAULT_THEME_IMAGE.blur)),
    dim: Math.round(clamp(raw.dim, 0, 0.9, DEFAULT_THEME_IMAGE.dim) * 100) / 100,
  };
}

export interface AppSettings {
  shortcuts: ShortcutBinding[];
  /** 在线更新源地址（generic provider，局域网/本机静态目录即可）；清空表示不启用 */
  updateFeedUrl: string | null;
  /** 代码高亮主题（对话消息列表与预览），对应 UI 侧 CODE_THEMES 目录里的 id */
  codeTheme: string;
  /** 界面主题（预设 / system / 自定义主题 custom:<id>） */
  theme: ThemeSelection;
  /** 自定义主题：定义体量很小（几十个颜色），直接放设置文件，避免再开一套存储 */
  customThemes: CustomTheme[];
  /** 界面强调色，与深浅模式独立 */
  accentColor: AccentColor;
  /** 聊天内容区的图片背景 */
  themeImage: ThemeImageSettings;
  /** 界面语言 */
  locale: AppLocale;
  /** 左下角/资料页展示哪个账户的身份 */
  displayAccount: DisplayAccount;
  /** 计划模式全局默认模型；缺省 = 不指定，沿用会话模型 */
  planModel?: PhaseModelRef | null;
  /** 执行/交互模式全局默认模型 */
  actModel?: PhaseModelRef | null;
}

/** 默认代码主题：GitHub 深浅成对 */
export const DEFAULT_CODE_THEME = "github";

/**
 * 默认界面主题：浅色（对齐 nomi 新安装默认）。
 * 已有用户设置文件里保存的值优先，不会被这个默认覆盖。
 */
export const DEFAULT_THEME: ThemeMode = "light";

export const MAX_CUSTOM_THEMES_PER_SETTINGS = 50;

/** 归一自定义主题列表：非法条目丢弃、按 id 去重、上限截断 */
export function normalizeCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CustomTheme[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_CUSTOM_THEMES_PER_SETTINGS)) {
    const theme = normalizeCustomTheme(item, isValidThemeImageId);
    if (theme && !seen.has(theme.id)) {
      seen.add(theme.id);
      out.push(theme);
    }
  }
  return out;
}

/** 新主题的 id：短、可读、够用（同机不会冲突到需要 UUID） */
export function createCustomThemeId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * 默认强调色：nomi 复刻（浅色陶土红 / 深色靛蓝，随主题切换）。
 * 旧版暖橙仍可选，已保存的选择不会被覆盖。
 */
export const DEFAULT_ACCENT_COLOR: AccentColor = "nomi";
export const ACCENT_COLORS: readonly AccentColor[] = ["nomi", "orange", "blue", "purple", "red", "green", "cyan"];

export function normalizeAccentColor(value: unknown): AccentColor {
  return ACCENT_COLORS.find((color) => color === value) ?? DEFAULT_ACCENT_COLOR;
}

/** 默认界面语言：简体中文 */
export const DEFAULT_LOCALE: AppLocale = "zh-CN";

/** 更新源默认值：updates-server.mjs 的端口需与此保持一致 */
export const DEFAULT_UPDATE_FEED_URL = "http://127.0.0.1:8899";

/** 在线更新状态（临时开放功能：generic 更新源） */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatusInfo {
  phase: UpdatePhase;
  /** 检查到的新版本号（available / downloaded 时有值） */
  version?: string;
  releaseNotes?: string | null;
  /** 下载进度 0-100（downloading） */
  percent?: number;
  /** 错误信息（error） */
  message?: string;
}

const SHORTCUT_MODIFIERS = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

/** 多字符键的规范写法，与 shortcutKeyFromEvent 产出对齐（Arrow 前缀去除）。 */
const CANONICAL_KEYS: Record<string, string> = {
  enter: "Enter",
  space: "Space",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  backspace: "Backspace",
  delete: "Delete",
};

/** 与 DOM KeyboardEvent 解耦，shared 包无需依赖 DOM lib。 */
export interface ShortcutKeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function normalizeShortcutKey(value: string): string {
  const parts = value
    .split("+")
    .map((part) => (part === " " ? "Space" : part.trim()))
    .filter((part) => part.length > 0);
  const modifiers = new Set<string>();
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    const modifier =
      lower === "cmd" || lower === "command" || lower === "meta"
        ? "Cmd"
        : lower === "ctrl" || lower === "control"
          ? "Ctrl"
          : lower === "alt" || lower === "option"
            ? "Alt"
            : lower === "shift"
              ? "Shift"
              : undefined;
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    key =
      part === " "
        ? "Space"
        : part.length === 1
          ? part.toUpperCase()
          : (CANONICAL_KEYS[lower] ?? lower);
  }

  return [
    ...SHORTCUT_MODIFIERS.filter((modifier) => modifiers.has(modifier)),
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function shortcutKeyFromEvent(event: ShortcutKeyEventLike): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
    return null;
  }
  const key =
    event.key === " "
      ? "Space"
      : event.key.startsWith("Arrow")
        ? event.key.replace("Arrow", "")
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
  return normalizeShortcutKey(
    [
      event.metaKey ? "Cmd" : "",
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      key,
    ]
      .filter(Boolean)
      .join("+"),
  );
}

export function shortcutMatches(event: ShortcutKeyEventLike, shortcut: string): boolean {
  return shortcutKeyFromEvent(event) === normalizeShortcutKey(shortcut);
}

export interface AuthState {
  loggedIn: boolean;
  user: GitHubUser | null;
  error?: string | null;
  /** 本次登录时间戳；登录态自登录起 3 个月有效 */
  loginAt?: number | null;
  /** 访问令牌到期时间（GitHub App 过期令牌才有；长期令牌为空） */
  expiresAt?: number | null;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: "quick-open", label: "快速打开", command: "workbench.action.quickOpen", key: "Cmd+P" },
  { id: "command-palette", label: "命令面板", command: "workbench.action.showCommands", key: "Shift+Cmd+P" },
  { id: "toggle-sidebar", label: "切换侧边栏", command: "workbench.action.toggleSidebarVisibility", key: "Cmd+B" },
  { id: "toggle-info", label: "切换信息面板", command: "workbench.action.toggleInfoPanel", key: "Cmd+I" },
  { id: "toggle-right", label: "切换右侧面板", command: "workbench.action.toggleRightPanel", key: "Cmd+J" },
  { id: "toggle-terminal", label: "切换终端", command: "workbench.action.terminal.toggleTerminal", key: "Ctrl+`" },
  { id: "find", label: "查找", command: "actions.find", key: "Cmd+F" },
  { id: "settings", label: "打开设置", command: "workbench.action.openSettings", key: "Cmd+," },
  { id: "new-task", label: "新建任务", command: "zen.action.newTask", key: "Cmd+N" },
  { id: "send-message", label: "发送消息", command: "zen.chat.send", key: "Enter" },
];

/**
 * 允许注册为系统全局快捷键的命令白名单：
 * 只收「拉起窗口就能执行」且已实现的动作；发送消息（裸 Enter）、面板切换这类
 * 依赖应用内焦点的命令不进白名单，避免抢占系统级按键。
 */
export const GLOBAL_SHORTCUT_COMMANDS = new Set<string>([
  "workbench.action.openSettings",
  "zen.action.newTask",
]);
