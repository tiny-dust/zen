export interface TerminalShellInfo {
  path: string;
  args: string[];
  label: string;
  source: "env" | "login" | "fallback";
}

export interface TerminalSessionInfo {
  id: string;
  shell: string;
  cwd: string;
  pid: number;
  cols: number;
  rows: number;
}

export interface TerminalCreateResult {
  ok: boolean;
  session?: TerminalSessionInfo;
  error?: string;
}

export interface TerminalOpenExternalResult {
  ok: boolean;
  opener?: string;
  error?: string;
}

/** 终端字体：优先系统终端配置，并保证 Nerd Font / icon 可回退 */
export interface TerminalFontSettings {
  /** CSS font-family 列表（已含 Nerd Font 回退） */
  fontFamily: string;
  fontSize: number;
  /** 解析出的主字体显示名 */
  primaryFamily: string;
  /** 主字体来源 */
  source:
    | "vscode"
    | "cursor"
    | "iterm"
    | "terminal-app"
    | "windows-terminal"
    | "alacritty"
    | "kitty"
    | "fallback";
  /** 主字体是否为 Nerd Font（含 icon 字形） */
  isNerdFont: boolean;
}

export interface PtyDataEvent {
  sessionId: string;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface TerminalAgentBridge {
  /** 非交互执行（供 agent runTerminal 升级为可见终端会话时复用配置） */
  defaultShell(): TerminalShellInfo;
}
