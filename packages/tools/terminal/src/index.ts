import type { TerminalShellInfo } from "@zen/shared";

export function createTerminalToolPlaceholder(): string {
  return "terminal";
}

/** 解析系统默认登录 shell（优先 $SHELL，再按平台回落） */
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
      // 登录 shell，加载用户 profile（nvm/homebrew 等）
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
