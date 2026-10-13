/**
 * zen CLI 行协议（纯函数）：JSON + 换行。
 * 请求：{"token":"<hex>","command":"ping|sessions|ask|open","args":{...}}\n * 响应：{"ok":true,...} 或 {"ok":false,"error":"..."}，同样以换行结尾。
 * 协议解析与分帧不含 Electron / net 依赖，可单测。
 */

export const CLI_COMMANDS = ["ping", "sessions", "ask", "open"] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export interface CliRequest {
  token: string;
  command: CliCommand;
  args: Record<string, unknown>;
}

export type ParseCliLineResult =
  | { ok: true; request: CliRequest }
  | { ok: false; error: string };

/** 解析一行请求：JSON 合法、token 非空、command 在集合内、args（可选）为纯对象 */
export function parseCliLine(line: string): ParseCliLineResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return { ok: false, error: "empty line" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "request must be an object" };
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.token !== "string" || !raw.token) {
    return { ok: false, error: "missing token" };
  }
  if (typeof raw.command !== "string" || !(CLI_COMMANDS as readonly string[]).includes(raw.command)) {
    return { ok: false, error: `unknown command: ${String(raw.command)}` };
  }
  if (raw.args != null && (typeof raw.args !== "object" || Array.isArray(raw.args))) {
    return { ok: false, error: "args must be an object" };
  }
  return {
    ok: true,
    request: {
      token: raw.token,
      command: raw.command as CliCommand,
      args: (raw.args ?? {}) as Record<string, unknown>,
    },
  };
}

/** 鉴权：token 不匹配即拒（调用方收到 false 后应断开连接） */
export function isAuthorized(request: CliRequest, expectedToken: string): boolean {
  return request.token === expectedToken;
}

/** 响应编码：单行 JSON + \n（跨平台一致，Windows 不用 \r\n） */
export function encodeCliResponse(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

/**
 * 行分帧器：TCP chunk 可能半行/多行粘包，跨 chunk 缓冲并按 \n 切分（容忍 \r\n）。
 * 返回本次新完成的完整行；剩余不完整部分留在内部缓冲。
 */
export function createCliLineSplitter(): (chunk: string) => string[] {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines: string[] = [];
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      if (line.trim()) {
        lines.push(line);
      }
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
    return lines;
  };
}
