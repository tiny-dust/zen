import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * 外部 CLI 运行时：把本机已安装的 Claude Code / Codex 当作会话底座。
 * 只探测已安装的可执行文件，不安装、不读取登录凭据、不传跳过审批的参数。
 */

export type CliRuntimeId = "claude" | "codex";

export interface CliRuntimeInfo {
  id: CliRuntimeId;
  label: string;
  command: string;
  /** PATH 解析到的绝对路径；null = 未安装 */
  path: string | null;
}

interface CliCandidate {
  id: CliRuntimeId;
  label: string;
  command: string;
  /** 非交互单轮的参数；提示词作为独立参数传入，不做 shell 拼接 */
  args: (prompt: string) => string[];
}

const CANDIDATES: readonly CliCandidate[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    args: (prompt) => ["-p", prompt, "--output-format", "text"],
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    args: (prompt) => ["exec", prompt],
  },
];

/** 可执行文件后缀：Windows 需要按 PATHEXT 逐个试，其它平台为空 */
function executableSuffixes(): string[] {
  if (process.platform !== "win32") {
    return [""];
  }
  const pathext = process.env.PATHEXT ?? ".EXE;.CMD;.BAT";
  return ["", ...pathext.split(";").filter(Boolean).map((ext) => ext.toLowerCase())];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 在 PATH 中解析命令；找不到返回 null（不抛错，缺装是正常状态） */
export function resolveOnPath(command: string, pathEnv = process.env.PATH ?? ""): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const suffix of executableSuffixes()) {
      const candidate = join(dir, command + suffix);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/** 探测全部受支持的 CLI（结果稳定按候选顺序，便于 UI 直接渲染） */
export function detectCliRuntimes(pathEnv?: string): CliRuntimeInfo[] {
  return CANDIDATES.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    command: candidate.command,
    path: resolveOnPath(candidate.command, pathEnv),
  }));
}

export interface CliRunOptions {
  /** 已解析的绝对路径（来自 detectCliRuntimes） */
  path: string;
  id: CliRuntimeId;
  prompt: string;
  cwd: string;
  /** 增量正文回调；已去掉 ANSI 控制序列 */
  onDelta: (text: string) => void;
}

export interface CliRun {
  /** 进程退出（正常结束或被杀）后 resolve；close 只发生一次 */
  done: Promise<{ ok: boolean; exitCode: number | null; error?: string }>;
  /** 停止：先 SIGTERM，3s 未退再强杀；Windows 用 taskkill 结束进程树 */
  stop: () => void;
}

/** 失败时回传给界面判断原因的 stderr 保留量（字符） */
const STDERR_TAIL_LIMIT = 4000;

/** 去掉终端着色与回车覆盖，避免流式正文里混入控制字符 */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

export interface CliProcessOptions {
  /** 已解析的绝对路径（resolveOnPath 结果） */
  path: string;
  /** 参数数组：直接交给 spawn，不经过 shell */
  args: string[];
  cwd: string;
  /** 增量正文回调；已去掉 ANSI 控制序列 */
  onDelta: (text: string) => void;
}

/**
 * 按给定参数启动 CLI 子进程：单轮执行与「在原厂商会话里续聊」共用这一层，
 * 停止策略只有一份实现。
 */
export function spawnCliProcess(options: CliProcessOptions): CliRun {
  const child: ChildProcessWithoutNullStreams = spawn(options.path, options.args, {
    cwd: options.cwd,
    env: process.env,
    // 不经过 shell：参数里有用户输入，拼接会带来注入面
    shell: false,
    // POSIX 下自成一个进程组，停止时能连 CLI 拉起的后代一起收掉
    detached: process.platform !== "win32",
  });

  // 关掉 stdin：`-p` / `exec` 这类非交互模式不读输入，留着管道会让 CLI 干等 EOF
  child.stdin.end();

  let stopped = false;
  let exited = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const done = new Promise<{ ok: boolean; exitCode: number | null; error?: string }>((resolve) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const text = stripAnsi(chunk);
      if (text) {
        options.onDelta(text);
      }
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // 只留尾部：CLI 可能长时间刷日志，全量累积会撑爆内存
      stderr = (stderr + stripAnsi(chunk)).slice(-STDERR_TAIL_LIMIT);
    });

    child.on("error", (error) => {
      resolve({ ok: false, exitCode: null, error: error.message });
    });

    child.on("close", (code) => {
      exited = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
      const ok = code === 0;
      // 失败时透出 stderr 尾部，方便判断是未登录还是参数错误
      const error = ok ? undefined : (stderr.trim().slice(-500) || `cli exited with code ${code}`);
      resolve({ ok, exitCode: code, error });
    });
  });

  function stop() {
    // 进程已退出或已停过：不再发信号，避免 pid 被系统复用时误杀无关进程
    if (stopped || exited) {
      return;
    }
    stopped = true;
    const pid = child.pid;
    if (!pid) {
      return;
    }
    if (process.platform === "win32") {
      // Windows 下 SIGTERM 不可用：结束整棵进程树
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    // 子进程已是进程组组长（detached），按负 pid 终止整组，连带 CLI 拉起的后代
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    killTimer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 3000);
  }

  return { done, stop };
}

/** 单轮执行（新建对话）：参数由候选表决定，行为与之前一致 */
export function startCliRun(options: CliRunOptions): CliRun {
  const candidate = CANDIDATES.find((item) => item.id === options.id);
  if (!candidate) {
    throw new Error(`unsupported cli runtime: ${options.id}`);
  }
  return spawnCliProcess({
    path: options.path,
    args: candidate.args(options.prompt),
    cwd: options.cwd,
    onDelta: options.onDelta,
  });
}
