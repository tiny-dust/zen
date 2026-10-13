#!/usr/bin/env node
/**
 * zen-cli：Zen 桌面端的本地命令行入口（纯 Node，无依赖，Node 18+）。
 * 读取 ~/.zen/cli-socket.json（主进程启动时写入 port/token），
 * 通过 127.0.0.1 TCP + JSON 行协议与主进程通信。
 *
 * 用法：
 *   zen-cli ping
 *   zen-cli list
 *   zen-cli ask <workspacePath> <message...>   # workspacePath 可传 - 表示公共区
 *   zen-cli open <sessionId>
 */

import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SOCKET_FILE = join(homedir(), ".zen", "cli-socket.json");
const TIMEOUT_MS = 11 * 60_000; // 略大于服务端 ask 等待上限

function usage(code = 1) {
  process.stderr.write(
    [
      "用法：zen-cli <command> [args]",
      "",
      "命令：",
      "  ping                          测试与 Zen 主进程的连接",
      "  list                          列出最近会话（id / 标题 / 工作区 / 更新时间）",
      "  ask <workspacePath> <msg...>  在指定工作区新建会话并运行 Agent，返回回复摘要",
      "                                （workspacePath 传 - 表示公共区）",
      "  open <sessionId>              让 Zen 窗口打开该会话",
      "",
      "需先启动 Zen 桌面端（CLI 服务随主进程启动）。",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function readSocketInfo() {
  let raw;
  try {
    raw = readFileSync(SOCKET_FILE, "utf8");
  } catch {
    process.stderr.write(
      `未找到 ${SOCKET_FILE}：请先启动 Zen 桌面端（CLI 服务随主进程启动）。\n`,
    );
    process.exit(1);
  }
  try {
    const info = JSON.parse(raw);
    if (typeof info.port !== "number" || typeof info.token !== "string") {
      throw new Error("bad format");
    }
    return info;
  } catch {
    process.stderr.write(`${SOCKET_FILE} 内容损坏，请重启 Zen 桌面端。\n`);
    process.exit(1);
  }
}

/** 组装协议请求行 */
function buildRequest(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "ping":
      return { token: readSocketInfo().token, command: "ping" };
    case "list":
    case "sessions":
      return { token: readSocketInfo().token, command: "sessions" };
    case "ask": {
      const [workspacePath, ...messageParts] = rest;
      if (!messageParts.length) {
        usage();
      }
      const workspacePathValue = !workspacePath || workspacePath === "-" ? "" : workspacePath;
      return {
        token: readSocketInfo().token,
        command: "ask",
        args: { workspacePath: workspacePathValue, message: messageParts.join(" ") },
      };
    }
    case "open": {
      const [sessionId] = rest;
      if (!sessionId) {
        usage();
      }
      return { token: readSocketInfo().token, command: "open", args: { sessionId } };
    }
    default:
      usage();
  }
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function printResponse(response) {
  if (!response.ok) {
    process.stderr.write(`错误：${response.error ?? "unknown"}\n`);
    process.exit(1);
  }
  if (response.pong === true) {
    process.stdout.write(`Zen 已连接（v${response.version ?? "?"}，${response.platform ?? "?"}）\n`);
    return;
  }
  if (Array.isArray(response.sessions)) {
    if (!response.sessions.length) {
      process.stdout.write("（暂无会话）\n");
      return;
    }
    for (const session of response.sessions) {
      process.stdout.write(
        `${session.id}  ${formatTime(session.updatedAt)}  [${session.workspace}]  ${session.title}\n`,
      );
    }
    return;
  }
  if (response.reply != null) {
    process.stdout.write(`会话：${response.sessionId}（${response.title ?? ""}）\n`);
    process.stdout.write(`${response.reply}\n`);
    if (response.note) {
      process.stderr.write(`提示：${response.note}\n`);
    }
    return;
  }
  process.stdout.write("完成。\n");
}

function main() {
  if (process.argv.length < 3) {
    usage();
  }
  const info = readSocketInfo();
  const request = buildRequest(process.argv.slice(2));
  const socket = createConnection({ host: "127.0.0.1", port: info.port });
  socket.setEncoding("utf8");
  const timer = setTimeout(() => {
    process.stderr.write("等待 Zen 响应超时。\n");
    socket.destroy();
    process.exit(1);
  }, TIMEOUT_MS);
  timer.unref?.();
  let buffer = "";
  socket.on("connect", () => {
    socket.write(`${JSON.stringify(request)}\n`);
  });
  socket.on("data", (chunk) => {
    buffer += chunk;
    const index = buffer.indexOf("\n");
    if (index < 0) {
      return;
    }
    const line = buffer.slice(0, index).trim();
    socket.end();
    clearTimeout(timer);
    try {
      printResponse(JSON.parse(line));
    } catch {
      process.stderr.write(`响应解析失败：${line}\n`);
      process.exit(1);
    }
  });
  socket.on("error", (error) => {
    process.stderr.write(`连接失败：${error.message}\n`);
    process.exit(1);
  });
}

main();
