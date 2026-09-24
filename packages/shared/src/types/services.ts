/** runTerminal 起的持续运行服务（dev server / watch 等）：主进程按进程组跟踪 */
export interface AgentServiceInfo {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  startedAt: number;
  /** 进程组内当前存活进程（不含已退出的启动 shell） */
  pids: number[];
}
