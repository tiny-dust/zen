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
}

export interface AuthState {
  loggedIn: boolean;
  user: GitHubUser | null;
  error?: string | null;
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
