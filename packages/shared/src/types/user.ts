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

export type AppIconId = "zen-ink" | "zen-mint" | "zen-ember" | "zen-mono" | "custom";

export interface ShortcutBinding {
  id: string;
  label: string;
  command: string;
  key: string;
  when?: string;
}

export interface AppSettings {
  iconId: AppIconId;
  customIconPath: string | null;
  shortcuts: ShortcutBinding[];
  /** 在线更新源地址（generic provider，局域网/本机静态目录即可）；清空表示不启用 */
  updateFeedUrl: string | null;
}

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
  { id: "toggle-terminal", label: "切换终端", command: "workbench.action.terminal.toggleTerminal", key: "Ctrl+`" },
  { id: "find", label: "查找", command: "actions.find", key: "Cmd+F" },
  { id: "settings", label: "打开设置", command: "workbench.action.openSettings", key: "Cmd+," },
  { id: "new-task", label: "新建任务", command: "zen.action.newTask", key: "Cmd+N" },
  { id: "send-message", label: "发送消息", command: "zen.chat.send", key: "Enter" },
];

export const BUILTIN_APP_ICONS: Array<{ id: Exclude<AppIconId, "custom">; label: string }> = [
  { id: "zen-ink", label: "墨玉" },
  { id: "zen-mint", label: "薄荷" },
  { id: "zen-ember", label: "余烬" },
  { id: "zen-mono", label: "素白" },
];
