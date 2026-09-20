import type { McpServerConfig, McpToolInfo } from "@zen/shared";

/** tools/call 结果：文本内容拼接（MCP content blocks 里的 text）+ 错误 */
export interface McpCallResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** JSON-RPC 2.0 消息（请求/响应/通知共用） */
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 三种传输方式的统一客户端面（mcp-ipc 只依赖这里） */
export interface McpClient {
  readonly name: string;
  readonly isConnected: boolean;
  readonly error: string | null;
  connect(): Promise<void>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(toolName: string, args: unknown): Promise<McpCallResult>;
  shutdown(): void;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * JSON-RPC 公共底座：id 分配、pending 表、超时与结果分发。
 * 子类只负责 sendRaw（把序列化消息发出去）与把入站消息喂给 handleResponse。
 */
export abstract class McpBaseClient implements McpClient {
  protected readonly config: McpServerConfig;
  private nextId = 1;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  abstract get isConnected(): boolean;
  abstract get error(): string | null;
  abstract connect(): Promise<void>;
  abstract shutdown(): void;

  protected abstract sendRaw(payload: string): void;

  /** 入站 JSON-RPC 消息（响应按 id 分发；服务端通知当前忽略） */
  protected handleResponse(message: JsonRpcMessage): void {
    if (typeof message.id === "number") {
      const resolver = this.pending.get(message.id);
      if (resolver) {
        this.pending.delete(message.id);
        resolver(message);
      }
    }
  }

  protected request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} 超时（30s）`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(`MCP ${method}: ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      });
      try {
        this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  protected notify(method: string, params: unknown): void {
    this.sendRaw(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  protected rejectAllPending(reason: string): void {
    for (const [id, resolver] of this.pending) {
      resolver({ jsonrpc: "2.0", id, error: { code: -32000, message: reason } });
    }
    this.pending.clear();
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    return (result.tools ?? []).map((tool) => ({
      serverId: this.config.id,
      name: tool.name ?? "",
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async callTool(toolName: string, args: unknown): Promise<McpCallResult> {
    try {
      const result = (await this.request("tools/call", {
        name: toolName,
        arguments: args ?? {},
      })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      const text = (result.content ?? [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
      return { ok: result.isError !== true, text, error: result.isError ? text : undefined };
    } catch (error) {
      return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * SSE 流解析：把字节流切成事件，交给 onEvent(event, data)。
 * 处理跨块多字节字符、CRLF、多行 data 与注释心跳。
 */
export function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new Promise((resolve, reject) => {
    const reader = body.getReader();
    const pump = (): void => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            resolve();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          // 事件以空行分隔；兼容 \r\n
          for (;;) {
            const separator = /\r?\n\r?\n/.exec(buffer);
            if (!separator) {
              break;
            }
            const raw = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            dispatchEventBlock(raw, onEvent);
          }
          pump();
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    };
    pump();
  });
}

function dispatchEventBlock(
  block: string,
  onEvent: (event: string, data: string) => void,
): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue; // 注释/心跳
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      event = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
    // id / retry 等字段当前用不到
  }
  if (dataLines.length) {
    onEvent(event, dataLines.join("\n"));
  }
}
