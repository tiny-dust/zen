import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { EXTERNAL_AGENT_CLIENTS } from "@zen/shared";
import type {
  ExternalAgentClient,
  ExternalClientCapability,
  ExternalResumeBlocked,
  ExternalRunEvent,
  ExternalRunStarted,
  ExternalSessionSummary,
} from "@zen/shared";

import { resolveOnPath, spawnCliProcess, type CliRun } from "./cli-runtime";
import { findExternalSession, isResumableSessionId } from "./external-sessions";

/**
 * 在厂商自己的会话里续聊：探测本机 CLI、按固定配方起子进程、登记运行与停止。
 *
 * 原则是「宁可禁用，不伪造」：没装 CLI、版本没有续聊参数、需求没核实过的客户端，
 * 一律不给续聊能力，也不退化成用 Zen 新会话假装继续。
 */

/** gemini --help 的探测超时 */
const HELP_PROBE_TIMEOUT_MS = 5000;
/** 能力探测缓存：避免每次开面板都起子进程 */
const CAPABILITY_TTL_MS = 60_000;
/** 单条续聊消息上限（字符） */
const MAX_MESSAGE_LENGTH = 20_000;
/** --help 输出只保留这么多字符用于判断参数是否存在 */
const HELP_OUTPUT_LIMIT = 64_000;

/** 续聊配方：只有这三条经过核实，其余客户端不猜参数 */
export function buildResumeArgs(
  client: ExternalAgentClient,
  sessionId: string,
  message: string,
): string[] | null {
  switch (client) {
    case "claude":
      return ["--resume", sessionId, "-p", message, "--output-format", "text"];
    case "codex":
      return ["exec", "resume", sessionId, message];
    case "gemini":
      return ["--resume", sessionId, "-p", message];
    default:
      return null;
  }
}

/** gemini 需要跑一次 --help 看有没有 --resume：失败/超时都按不支持处理，不猜 */
function geminiSupportsResume(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(path, ["--help"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: string) => {
      if (output.length < HELP_OUTPUT_LIMIT) {
        output += chunk;
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (supported: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(supported);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, HELP_PROBE_TIMEOUT_MS);

    child.on("error", () => finish(false));
    child.on("close", () => finish(output.includes("--resume")));
  });
}

async function probeClient(client: ExternalAgentClient, pathEnv: string): Promise<ExternalClientCapability> {
  const path = resolveOnPath(client, pathEnv);
  if (!path) {
    return { client, command: client, path: null, resume: "missing-cli", note: `本机未安装 ${client}` };
  }
  if (client === "claude" || client === "codex") {
    return { client, command: client, path, resume: "supported" };
  }
  if (client === "gemini") {
    if (await geminiSupportsResume(path)) {
      return { client, command: client, path, resume: "supported" };
    }
    return {
      client,
      command: client,
      path,
      resume: "unsupported",
      note: "当前 gemini 版本没有 --resume，无法用会话 ID 续聊",
    };
  }
  return { client, command: client, path, resume: "unsupported", note: "暂不支持用会话 ID 续聊" };
}

interface CapabilityCache {
  pathEnv: string;
  at: number;
  result: ExternalClientCapability[];
}

let capabilityCache: CapabilityCache | null = null;

/** 五个客户端各一条能力；结果缓存 60s，按 PATH 分组 */
export async function detectExternalCapabilities(
  options: { pathEnv?: string; fresh?: boolean } = {},
): Promise<ExternalClientCapability[]> {
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  if (!options.fresh && capabilityCache && capabilityCache.pathEnv === pathEnv) {
    if (Date.now() - capabilityCache.at < CAPABILITY_TTL_MS) {
      return capabilityCache.result;
    }
  }
  const result = await Promise.all(EXTERNAL_AGENT_CLIENTS.map((client) => probeClient(client, pathEnv)));
  capabilityCache = { pathEnv, at: Date.now(), result };
  return result;
}

// ---------------------------------------------------------------------------
// 运行登记：同一个会话同时只允许一条续聊进程
// ---------------------------------------------------------------------------

interface ActiveRun {
  id: string;
  runId: string;
  stop: () => void;
  /** 已由 stop() 广播过 stopped，退出时不再补发 error */
  stopped: boolean;
}

const activeById = new Map<string, ActiveRun>();
const activeByRunId = new Map<string, ActiveRun>();

/** 首个输出前的等待上限 / 单次运行上限（测试可注入更短的值） */
const FIRST_OUTPUT_MS = 90_000;
const HARD_MS = 10 * 60_000;

export interface ExternalSendDeps {
  /** 覆盖 PATH（测试用） */
  pathEnv?: string;
  /** 固定能力表，跳过探测（测试用） */
  capabilities?: ExternalClientCapability[];
  /** 覆盖会话查询（测试用） */
  findSession?: (id: string) => Promise<ExternalSessionSummary | null>;
  /** 首个输出前的等待上限（测试用，默认 90s） */
  firstOutputMs?: number;
  /** 单次运行上限（测试用，默认 10min） */
  hardMs?: number;
}

export type ExternalSendResult = ExternalRunStarted | { error: string; blocked?: ExternalResumeBlocked };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 发一条续聊消息：入参按 unknown 收，客户端 / 会话 ID / 目录全部取自本地扫描结果，
 * 任何一步不满足都返回 { error, blocked }，不向渲染层抛错。
 */
export async function sendExternalMessage(
  request: unknown,
  broadcast: (event: ExternalRunEvent) => void,
  deps: ExternalSendDeps = {},
): Promise<ExternalSendResult> {
  const record = asRecord(request);
  const id = typeof record?.["id"] === "string" ? record["id"].trim() : "";
  const message = typeof record?.["message"] === "string" ? record["message"] : "";
  if (!id) {
    return { error: "缺少会话 id", blocked: "unknown-session" };
  }
  if (!message.trim()) {
    return { error: "消息不能为空" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `消息超过 ${MAX_MESSAGE_LENGTH} 字符上限` };
  }

  const findSession = deps.findSession ?? findExternalSession;
  const session = await findSession(id);
  if (!session) {
    return { error: "本机会话列表里找不到该会话", blocked: "unknown-session" };
  }
  if (!isResumableSessionId(session.sessionId)) {
    return { error: "该会话的 id 格式不受支持", blocked: "unknown-session" };
  }

  const capabilities =
    deps.capabilities ??
    (await detectExternalCapabilities(deps.pathEnv === undefined ? {} : { pathEnv: deps.pathEnv }));
  const capability = capabilities.find((item) => item.client === session.client);
  if (!capability) {
    return { error: `未知客户端：${session.client}`, blocked: "unsupported" };
  }
  if (capability.resume === "missing-cli" || !capability.path) {
    return { error: capability.note ?? `本机未安装 ${capability.command}`, blocked: "missing-cli" };
  }
  if (capability.resume === "unsupported") {
    return { error: capability.note ?? "该客户端暂不支持用会话 ID 续聊", blocked: "unsupported" };
  }

  const args = buildResumeArgs(session.client, session.sessionId, message);
  if (!args) {
    return { error: "该客户端暂不支持用会话 ID 续聊", blocked: "unsupported" };
  }

  if (activeById.has(id)) {
    return { error: "该会话正在运行" };
  }

  const runId = randomUUID();
  let run: CliRun;
  let sawOutput = false;
  try {
    run = spawnCliProcess({
      path: capability.path,
      args,
      // 会话目录解析不出时落到用户主目录，不让 cwd 成为失败点
      cwd: session.cwd || homedir(),
      onDelta: (text) => {
        sawOutput = true;
        broadcast({ id, runId, type: "delta", text });
      },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const entry: ActiveRun = { id, runId, stop: run.stop, stopped: false };
  activeById.set(id, entry);
  activeByRunId.set(runId, entry);
  broadcast({ id, runId, type: "started" });

  // 看门狗：CLI 装上了但非交互模式里没反应（未登录 / 只在交互终端可用）时，
  // 不能让它永远转圈——超时就停进程并把原因说清楚。
  const firstOutputMs = deps.firstOutputMs ?? FIRST_OUTPUT_MS;
  const hardMs = deps.hardMs ?? HARD_MS;
  const watchdog = setTimeout(() => {
    if (entry.stopped) {
      return;
    }
    const reason = sawOutput
      ? "CLI 长时间没有结束，已停止"
      : "CLI 没有响应（可能需要先登录，或只能在交互终端里使用）";
    entry.stopped = true;
    run.stop();
    broadcast({ id, runId, type: "error", error: reason });
  }, firstOutputMs);
  const hardStop = setTimeout(() => {
    if (entry.stopped) {
      return;
    }
    entry.stopped = true;
    run.stop();
    broadcast({ id, runId, type: "error", error: "CLI 超过运行上限，已停止" });
  }, hardMs);
  const clearTimers = () => {
    clearTimeout(watchdog);
    clearTimeout(hardStop);
  };

  void run.done
    .then((result) => {
      clearTimers();
      activeById.delete(id);
      activeByRunId.delete(runId);
      if (entry.stopped) {
        return;
      }
      if (result.ok) {
        broadcast({ id, runId, type: "done" });
      } else {
        broadcast({ id, runId, type: "error", error: result.error ?? "运行失败" });
      }
    })
    .catch(() => {
      // 终止流程自身出错也要清理登记表，避免会话被永久占住
      clearTimers();
      activeById.delete(id);
      activeByRunId.delete(runId);
    });

  return { runId };
}

/** 停止一条续聊：广播 stopped，进程退出时不再补发 error */
export function stopExternalRun(runId: string, broadcast: (event: ExternalRunEvent) => void): boolean {
  const entry = activeByRunId.get(runId);
  if (!entry || entry.stopped) {
    return false;
  }
  entry.stopped = true;
  entry.stop();
  broadcast({ id: entry.id, runId, type: "stopped" });
  return true;
}
