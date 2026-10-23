/** runTerminal 起的持续运行服务（dev server / watch 等）：主进程按进程组跟踪 */
export interface AgentServiceInfo {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  startedAt: number;
  /** 进程组内当前存活进程（不含已退出的启动 shell） */
  pids: number[];
  /** 友好的展示名（从命令提炼：去掉路径/参数前缀，如 `pnpm dev --host` → `pnpm dev`） */
  label: string;
  /** 终端输出尾部（runTerminal 流式输出最近若干 KB，供右栏「服务」查看） */
  output?: string;
}
