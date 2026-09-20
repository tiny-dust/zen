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
