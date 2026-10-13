import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { BrowserWindow, app } from "electron";

import { runAgentRequest } from "./agent-runner";
import { createCliLineSplitter, encodeCliResponse, isAuthorized, parseCliLine } from "./cli-protocol";
import { createSession, createWorkspace, getSession, listWorkspaceGroups } from "./workspace-db";

import type { AgentSession } from "@zen/agent-core";
import type { AgentRunRequest } from "@zen/shared";

/**
 * zen CLI 本地 TCP 服务（竞品 DimAgent 的 dim CLI 本地版）：
 * - 仅监听 127.0.0.1，端口随机；端口 + token 写 ~/.zen/cli-socket.json，退出时删除；
 * - 行协议 JSON + 换行（见 cli-protocol.ts），每条命令带 token，不匹配即断开；
 * - 命令集：ping / sessions list / ask <workspacePath> <message> / open <sessionId>。
 * Windows 兼容：TCP + JSON 行协议天然跨平台，用户目录用 os.homedir()。
 */

/** 连接缓冲上限：超过即视为恶意连接直接断开 */
const MAX_BUFFER_CHARS = 1024 * 1024;

/** ask 等待 run 结束的上限（等审批/问询时 CLI 侧会挂起到这里） */
const ASK_TIMEOUT_MS = 10 * 60_000;

/** CLI 回传给客户端的回复摘要长度上限 */
const REPLY_MAX_CHARS = 8000;

/** 最近会话列表返回条数 */
const SESSIONS_LIMIT = 30;

interface CliSocketInfo {
  port: number;
  token: string;
  pid: number;
}

let server: Server | null = null;
let socketInfo: CliSocketInfo | null = null;

/** socket 信息文件路径：~/.zen/cli-socket.json（CLI 入口读取后连接） */
export function cliSocketFile(): string {
  return join(homedir(), ".zen", "cli-socket.json");
}

function send(socket: Socket, payload: unknown): void {
  if (!socket.destroyed) {
    socket.write(encodeCliResponse(payload));
  }
}

/** 最近会话列表：全部工作区拍平，按更新时间倒序 */
function listRecentSessions() {
  const groups = listWorkspaceGroups();
  const sessions = groups.flatMap((group) =>
    group.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      workspace: group.name,
      workspaceId: session.workspaceId ?? "common",
      updatedAt: session.updatedAt,
    })),
  );
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions.slice(0, SESSIONS_LIMIT);
}

/** 等待 run 结束（轮询运行状态；等审批/问询时挂起，直到完成或超时） */
async function waitForRunEnd(sessionId: string, sessions: Map<string, AgentSession>): Promise<boolean> {
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = sessions.get(sessionId)?.getRunState();
    const busy =
      state &&
      (state.runActive || state.waitingApproval || state.waitingAskCount > 0 || state.inserting);
    if (!busy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** 在指定工作区建/复用会话并 headless 运行 agent，返回最后一条助手回复摘要 */
async function handleAsk(
  args: Record<string, unknown>,
  sessions: Map<string, AgentSession>,
): Promise<Record<string, unknown>> {
  const workspacePath = typeof args.workspacePath === "string" ? args.workspacePath.trim() : "";
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) {
    return { ok: false, error: "missing message" };
  }
  let workspaceId: string;
  if (workspacePath) {
    const existing = listWorkspaceGroups().find(
      (group) => group.kind === "workspace" && group.path === workspacePath,
    );
    workspaceId = (existing ?? createWorkspace(workspacePath)).id;
  } else {
    // 未指定工作区：落到公共区（agent 产物目录由 runAgentRequest 兜底）
    workspaceId = "common";
  }
  const session = createSession(workspaceId);
  const request: AgentRunRequest = {
    sessionId: session.id,
    workspaceId,
    workspaceRoot: workspacePath,
    userMessage: message,
    history: [],
  };
  const result = await runAgentRequest(request, { sessions });
  const finished = await waitForRunEnd(session.id, sessions);
  const record = getSession(session.id);
  const reply =
    record?.messages
      .filter((item) => item.role === "assistant" && item.content.trim())
      .map((item) => item.content.trim())
      .at(-1) ?? "";
  const summary = reply.length > REPLY_MAX_CHARS ? `${reply.slice(0, REPLY_MAX_CHARS)}…` : reply;
  return {
    ok: result.ok && finished,
    sessionId: session.id,
    title: record?.session.title ?? message.slice(0, 24),
    ...(reply ? { reply: summary } : {}),
    ...(!result.ok && result.error ? { error: result.error } : {}),
    ...(finished ? {} : { note: "timed out waiting for the run to finish" }),
  };
}

/** 通知渲染层打开会话（session:open-request 频道）并聚焦主窗口 */
function handleOpen(
  args: Record<string, unknown>,
  broadcast: (channel: string, payload: unknown) => void,
): Record<string, unknown> {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  if (!sessionId) {
    return { ok: false, error: "missing sessionId" };
  }
  if (!getSession(sessionId)) {
    return { ok: false, error: "session not found" };
  }
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (!windows.length) {
    return { ok: false, error: "no open window" };
  }
  for (const win of windows) {
    win.show();
    win.focus();
  }
  broadcast("session:open-request", sessionId);
  return { ok: true, sessionId };
}

async function handleLine(
  socket: Socket,
  line: string,
  token: string,
  deps: {
    broadcast: (channel: string, payload: unknown) => void;
    sessions: Map<string, AgentSession>;
  },
): Promise<void> {
  const parsed = parseCliLine(line);
  if (!parsed.ok) {
    send(socket, { ok: false, error: parsed.error });
    return;
  }
  if (!isAuthorized(parsed.request, token)) {
    send(socket, { ok: false, error: "unauthorized" });
    socket.end();
    return;
  }
  const { command, args } = parsed.request;
  switch (command) {
    case "ping":
      send(socket, {
        ok: true,
        pong: true,
        version: app.getVersion(),
        platform: process.platform,
      });
      return;
    case "sessions":
      send(socket, { ok: true, sessions: listRecentSessions() });
      return;
    case "ask":
      send(socket, await handleAsk(args, deps.sessions));
      return;
    case "open":
      send(socket, handleOpen(args, deps.broadcast));
      return;
  }
}

export function startCliServer(
  broadcast: (channel: string, payload: unknown) => void,
  sessions: Map<string, AgentSession>,
): void {
  if (server) {
    return;
  }
  server = createServer((socket) => {
    const split = createCliLineSplitter();
    let chars = 0;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      chars += chunk.length;
      if (chars > MAX_BUFFER_CHARS) {
        socket.destroy();
        return;
      }
      for (const line of split(chunk)) {
        void handleLine(socket, line, socketInfo?.token ?? "", { broadcast, sessions }).catch(
          (error) => {
            send(socket, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
      }
    });
    socket.on("error", () => {
      // 连接异常（客户端强断等）：静默回收
      socket.destroy();
    });
  });
  server.on("error", (error) => {
    console.warn("[cli] TCP 服务启动失败:", error);
    server = null;
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server?.address();
    if (!address || typeof address === "string") {
      return;
    }
    socketInfo = { port: address.port, token: randomBytes(24).toString("hex"), pid: process.pid };
    void (async () => {
      try {
        await mkdir(dirname(cliSocketFile()), { recursive: true });
        await writeFile(cliSocketFile(), JSON.stringify(socketInfo, null, 2), "utf8");
      } catch (error) {
        console.warn("[cli] cli-socket.json 写入失败:", error);
      }
    })();
  });
}

/** 退出清理：关服务 + 删 socket 信息文件（失败不阻塞退出） */
export async function stopCliServer(): Promise<void> {
  const pending = server?.close();
  server = null;
  socketInfo = null;
  await pending;
  await rm(cliSocketFile(), { force: true }).catch(() => undefined);
}
