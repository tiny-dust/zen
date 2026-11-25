import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentStreamEvent, WorkspaceGroup } from "@zen/shared";
import type { LarkChatStartResult } from "../agent-runner";
import type { createSession, getSession } from "../workspace-db";

type SessionSnapshot = NonNullable<ReturnType<typeof getSession>>;
const MAX_RELAY_FRAME = 32_768;
// Leave room for the relay's 32 KiB inbound frame limit, including JSON envelope and escaping.
const RESPONSE_BUDGET = 30_000;
type ConnectionStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";
interface DeviceConfig {
  enabled: boolean;
  relayUrl: string;
  deviceId: string;
  secret: string;
  deviceName: string;
  username: string;
  password: string;
}
export interface RemoteStatus {
  enabled: boolean;
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  username: string;
  hasPassword: boolean;
  status: ConnectionStatus;
  error?: string;
}
export interface RemoteDeps {
  file: string;
  broadcast: (channel: string, payload: RemoteStatus) => void;
  listGroups: () => WorkspaceGroup[];
  getSession: (id: string) => SessionSnapshot | undefined;
  createSession: (workspaceId: string, id?: string) => ReturnType<typeof createSession>;
  isBusy: (id: string) => boolean;
  continueChat: (
    id: string,
    text: string,
    send: (event: AgentStreamEvent) => void,
    onFinished: () => void,
  ) => LarkChatStartResult;
  connect?: (url: string) => WebSocket;
}

function relayEndpoint(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入有效的 wss:// 服务地址");
  }
  if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "/ws/device")) {
    throw new Error("仅支持不含凭据或参数的 wss:// 服务地址");
  }
  url.pathname = "/ws/device";
  return url.toString();
}

function safeSession(session: SessionSnapshot["session"]) {
  return {
    id: session.id,
    title: session.title.slice(0, 200),
    workspaceId: session.workspaceId,
    archived: session.archived,
    updatedAt: session.updatedAt,
  };
}

export class RemoteBridge {
  private config: DeviceConfig | null = null;
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "disabled";
  private error: string | undefined;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1_000;
  private ready = false;
  private pendingPair: { resolve: (code: { code: string; expiresAt: number }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private pendingRotation: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly sending = new Set<string>();
  private readonly watched = new Set<string>();

  constructor(private readonly deps: RemoteDeps) {}

  async start(): Promise<RemoteStatus> {
    try {
      const raw = await readFile(this.deps.file, "utf8");
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") throw new Error("invalid config");
      const data = value as Partial<DeviceConfig>;
      if (typeof data.deviceId !== "string" || !data.deviceId ||
          typeof data.secret !== "string" || !/^[0-9a-f]{64}$/.test(data.secret) ||
          typeof data.relayUrl !== "string" || typeof data.enabled !== "boolean") {
        throw new Error("invalid config");
      }
      if (data.relayUrl) relayEndpoint(data.relayUrl);
      this.config = {
        deviceId: data.deviceId, secret: data.secret, relayUrl: data.relayUrl,
        deviceName: typeof data.deviceName === "string" ? data.deviceName : "",
        username: typeof data.username === "string" ? data.username : "",
        password: typeof data.password === "string" ? data.password : "",
        enabled: data.enabled,
      };
      if (this.config.enabled && (!this.config.deviceName || !this.config.username || !this.config.password)) {
        this.config.enabled = false;
        await this.save();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.status = "error";
        this.error = "远程配置损坏或无法读取，请在本地检查";
        this.publish();
        return this.getConfig();
      }
      this.config = { enabled: false, relayUrl: "", deviceId: randomUUID(), secret: randomBytes(32).toString("hex"), deviceName: "", username: "", password: "" };
      await this.save();
    }
    if (this.config.enabled) this.open();
    this.publish();
    return this.getConfig();
  }

  getConfig(): RemoteStatus {
    return {
      enabled: this.config?.enabled ?? false,
      relayUrl: this.config?.relayUrl ?? "",
      deviceId: this.config?.deviceId ?? "",
      deviceName: this.config?.deviceName ?? "",
      username: this.config?.username ?? "",
      hasPassword: Boolean(this.config?.password),
      status: this.status,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async setConfig(input: unknown): Promise<RemoteStatus> {
    if (!this.config) throw new Error("远程配置不可用");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("无效的远程设置");
    const patch = input as Record<string, unknown>;
    if (Object.keys(patch).some((key) => !["enabled", "relayUrl", "deviceName", "username", "password"].includes(key)) ||
        (patch.enabled !== undefined && typeof patch.enabled !== "boolean") ||
        ["relayUrl", "deviceName", "username", "password"].some((key) => patch[key] !== undefined && typeof patch[key] !== "string")) {
      throw new Error("无效的远程设置");
    }
    const relayUrl = typeof patch.relayUrl === "string" ? patch.relayUrl.trim() : this.config.relayUrl;
    const enabled = typeof patch.enabled === "boolean" ? patch.enabled : this.config.enabled;
    const deviceName = typeof patch.deviceName === "string" ? patch.deviceName.trim() : this.config.deviceName;
    const username = typeof patch.username === "string" ? patch.username.trim() : this.config.username;
    const password = typeof patch.password === "string" && patch.password ? patch.password : this.config.password;
    if (deviceName.length > 100 || username.length > 100 || password.length > 256) throw new Error("远程设置过长");
    if (relayUrl) relayEndpoint(relayUrl);
    if (enabled && (!relayUrl || !deviceName || !username || !password)) throw new Error("启用前请填写地址、设备名、用户名和密码");
    const changed = enabled !== this.config.enabled || relayUrl !== this.config.relayUrl ||
      deviceName !== this.config.deviceName || username !== this.config.username || password !== this.config.password;
    if (changed) {
      const next = { ...this.config, enabled, relayUrl, deviceName, username, password };
      await this.save(next);
      this.config = next;
      this.disconnect();
      this.status = "disabled";
      this.error = undefined;
      if (enabled) this.open();
      this.publish();
    }
    return this.getConfig();
  }

  async revoke(): Promise<RemoteStatus> {
    if (!this.config) throw new Error("远程配置不可用");
    if (!this.ready || !this.socket || this.pendingRotation) throw new Error("中继未连接；请先保持远程连接在线，或使用开关暂时关闭");
    const next = { ...this.config, enabled: false, secret: randomBytes(32).toString("hex") };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRotation = null;
        reject(new Error("中继撤销超时；连接状态不确定，请检查后重试"));
      }, 15_000);
      this.pendingRotation = { resolve, reject, timer };
      this.send(this.socket!, { type: "device.rotate", secret: next.secret });
    });
    await this.save(next);
    this.config = next;
    this.disconnect();
    this.status = "disabled";
    this.error = undefined;
    this.publish();
    return this.getConfig();
  }

  requestPairCode(): Promise<{ code: string; expiresAt: number }> {
    if (!this.ready || !this.socket || this.pendingPair) return Promise.reject(new Error("设备尚未连接或配对请求进行中"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPair = null;
        reject(new Error("配对请求超时"));
      }, 15_000);
      this.pendingPair = { resolve, reject, timer };
      this.send(this.socket!, { type: "pair.request" });
    });
  }

  shutdown(): void {
    this.disconnect();
    this.status = "disabled";
  }

  private async save(next = this.config): Promise<void> {
    if (!next) throw new Error("远程配置不可用");
    await mkdir(dirname(this.deps.file), { recursive: true });
    await writeFile(this.deps.file, JSON.stringify(next), { mode: 0o600 });
    // POSIX 保证已有文件也是 0600；Windows 的 mode 不控制 ACL，由用户目录权限隔离。
    if (process.platform !== "win32") await chmod(this.deps.file, 0o600);
  }

  private publish(): void {
    this.deps.broadcast("remote:status", this.getConfig());
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ready = false;
    this.watched.clear();
    if (this.pendingPair) {
      clearTimeout(this.pendingPair.timer);
      this.pendingPair.reject(new Error("设备已断开"));
      this.pendingPair = null;
    }
    if (this.pendingRotation) {
      clearTimeout(this.pendingRotation.timer);
      this.pendingRotation.reject(new Error("设备已断开，撤销状态不确定"));
      this.pendingRotation = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private open(): void {
    if (!this.config?.enabled || !this.config.relayUrl || this.socket) return;
    let socket: WebSocket;
    try {
      socket = (this.deps.connect ?? ((url: string) => new WebSocket(url)))(relayEndpoint(this.config.relayUrl));
    } catch {
      this.failed();
      return;
    }
    this.socket = socket;
    this.status = "connecting";
    this.publish();
    socket.addEventListener("open", () => {
      if (this.socket !== socket || !this.config?.enabled) return;
      this.send(socket, { type: "hello", deviceId: this.config.deviceId, secret: this.config.secret,
        name: this.config.deviceName, username: this.config.username, password: this.config.password });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string" || event.data.length > MAX_RELAY_FRAME) return;
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return; }
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const data = value as Record<string, unknown>;
      if (!this.ready) {
        if (data.type === "ready") {
          this.ready = true;
          this.retryDelay = 1_000;
          this.status = "connected";
          this.error = undefined;
          this.publish();
        } else if (data.type === "error") {
          this.error = "设备鉴权失败，请检查服务端设置";
          socket.close();
        }
        return;
      }
      if (data.type === "pair.code" && this.pendingPair &&
          typeof data.code === "string" && /^\d{6}$/.test(data.code) &&
          typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)) {
        const pair = this.pendingPair;
        this.pendingPair = null;
        clearTimeout(pair.timer);
        pair.resolve({ code: data.code, expiresAt: data.expiresAt });
      } else if (data.type === "device.rotated" && this.pendingRotation) {
        const task = this.pendingRotation;
        this.pendingRotation = null;
        clearTimeout(task.timer);
        task.resolve();
      } else if (data.type === "error" && this.pendingRotation) {
        const task = this.pendingRotation;
        this.pendingRotation = null;
        clearTimeout(task.timer);
        task.reject(new Error("中继撤销失败，请稍后重试"));
      } else if (data.type === "error" && this.pendingPair) {
        const pair = this.pendingPair;
        this.pendingPair = null;
        clearTimeout(pair.timer);
        pair.reject(new Error("配对请求过于频繁，请稍后重试"));
      } else if (data.type === "watch" && Array.isArray(data.sessionIds) &&
          data.sessionIds.length <= 100 && data.sessionIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
        this.watched.clear();
        for (const id of data.sessionIds) this.watched.add(id);
      } else if (data.type === "request") {
        this.handleRequest(socket, data);
      }
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.error = "连接服务失败";
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (this.pendingPair) {
        clearTimeout(this.pendingPair.timer);
        this.pendingPair.reject(new Error("设备已断开"));
        this.pendingPair = null;
      }
      if (this.pendingRotation) {
        clearTimeout(this.pendingRotation.timer);
        this.pendingRotation.reject(new Error("设备已断开，撤销状态不确定"));
        this.pendingRotation = null;
      }
      this.failed();
    });
  }

  private failed(): void {
    this.status = this.error ? "error" : "disconnected";
    this.publish();
    if (!this.config?.enabled || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  private send(socket: WebSocket, payload: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  private handleRequest(socket: WebSocket, data: Record<string, unknown>): void {
    const { id, action, sessionId, text, workspaceId, cursor } = data;
    if (cursor !== undefined && (typeof cursor !== "string" ||
        !(action === "sessions.get" ? /^(0|[1-9][0-9]{0,8})(?::(0|[1-9][0-9]{0,8}))?$/.test(cursor) : /^(0|[1-9][0-9]{0,8})$/.test(cursor)))) return;
    if (typeof id !== "string" || !id || id.length > 128) return;
    const response = (result: unknown) => ({ type: "response", id, ok: true, data: result });
    const fits = (result: unknown) => Buffer.byteLength(JSON.stringify(response(result))) <= RESPONSE_BUDGET;
    const respond = (ok: boolean, result?: unknown, error?: string) => {
      if (ok && !fits(result)) return this.send(socket, { type: "response", id, ok: false, error: "response too large" });
      this.send(socket, ok ? response(result) : { type: "response", id, ok: false, error });
    };
    if (action === "sessions.list") {
      if (sessionId !== undefined || text !== undefined || workspaceId !== undefined) return respond(false, undefined, "invalid request");
      try {
        const available = this.deps.listGroups();
        const workspaces = available.map((group) => ({ id: group.id, name: group.name.slice(0, 100), kind: group.kind }));
        const source = available.flatMap((group) => group.sessions.map((session) => ({ group, session })));
        const start = cursor === undefined ? 0 : Number(cursor);
        if (start > source.length) return respond(false, undefined, "invalid cursor");
        const groups: Array<{ id: string; name: string; sessions: ReturnType<typeof safeSession>[] }> = [];
        let next = start;
        while (next < source.length && next - start < 100) {
          const item = source[next]!;
          let entry = groups.at(-1);
          if (!entry || entry.id !== item.group.id) {
            entry = { id: item.group.id, name: item.group.name.slice(0, 200), sessions: [] };
            groups.push(entry);
          }
          entry.sessions.push(safeSession(item.session));
          if (!fits({ groups, workspaces, nextCursor: String(next + 1) })) {
            entry.sessions.pop();
            if (!entry.sessions.length) groups.pop();
            break;
          }
          next++;
        }
        respond(true, { groups, workspaces, nextCursor: next < source.length ? String(next) : null });
      } catch { respond(false, undefined, "sessions unavailable"); }
      return;
    }
    if (action === "sessions.create") {
      if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 128 ||
          sessionId !== undefined || text !== undefined || cursor !== undefined) return respond(false, undefined, "invalid request");
      try {
        if (!this.deps.listGroups().some((group) => group.id === workspaceId)) return respond(false, undefined, "workspace unavailable");
        return respond(true, { session: safeSession(this.deps.createSession(workspaceId)) });
      } catch { return respond(false, undefined, "workspace unavailable"); }
    }
    if (action !== "sessions.get" && action !== "message.send") return respond(false, undefined, "unsupported action");
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 128) return respond(false, undefined, "invalid session");
    if (action === "sessions.get" && text !== undefined) return respond(false, undefined, "invalid request");
    if (action === "message.send" && (typeof text !== "string" || !text.trim() || text.length > 8_000)) {
      return respond(false, undefined, "invalid message");
    }
    try {
      const record = this.deps.getSession(sessionId);
      if (!record || (action === "message.send" && record.session.archived)) return respond(false, undefined, "session unavailable");
      if (action === "sessions.get") {
        const messages = record.messages.filter((message) => message.role === "user" || message.role === "assistant");
        const [rawIndex, rawOffset] = typeof cursor === "string" ? cursor.split(":") : [];
        const end = rawIndex === undefined ? messages.length : Number(rawIndex);
        if (end > messages.length || (rawOffset !== undefined && (end === 0 || Number(rawOffset) === 0 ||
            Number(rawOffset) > messages[end - 1]!.content.length ||
            /[\uDC00-\uDFFF]/.test(messages[end - 1]!.content[Number(rawOffset)] ?? "")))) {
          return respond(false, undefined, "invalid cursor");
        }
        const snapshot = { session: safeSession(record.session), messages: [] as Array<{
          id: string; role: string; content: string; createdAt: number; offset: number; totalLength: number;
        }>, nextCursor: null as string | null };
        let index = end;
        let offset = rawOffset === undefined ? (index ? messages[index - 1]!.content.length : 0) : Number(rawOffset);
        while (index > 0 && end - index < 100) {
          const message = messages[index - 1]!;
          const safe = { id: message.id, role: message.role, content: "", createdAt: message.createdAt,
            offset: 0, totalLength: message.content.length };
          const candidate = (start: number) => {
            safe.offset = start;
            safe.content = message.content.slice(start, offset);
            snapshot.nextCursor = start ? `${index}:${start}` : index > 1 ? String(index - 1) : null;
            return fits(snapshot);
          };
          snapshot.messages.unshift(safe);
          let low = 0;
          let high = offset;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (candidate(middle)) high = middle;
            else low = middle + 1;
          }
          let start = low;
          if (start > 0 && /[\uDC00-\uDFFF]/.test(message.content[start]!)) start++;
          if (!candidate(start) || (start === offset && offset > 0)) {
            snapshot.messages.shift();
            break;
          }
          if (start > 0) { offset = start; break; }
          index--;
          offset = index ? messages[index - 1]!.content.length : 0;
        }
        snapshot.nextCursor = index > 0 ? `${index}:${offset}` : null;
        if (snapshot.messages.length === 0 && index > 0) return respond(false, undefined, "response too large");
        return respond(true, snapshot);
      }
      if (this.sending.has(sessionId) || this.deps.isBusy(sessionId)) return respond(false, undefined, "session busy");
      this.sending.add(sessionId);
      const result = this.deps.continueChat(sessionId, text as string,
        (event) => this.forwardEvent(socket, sessionId, event),
        () => this.sending.delete(sessionId));
      if (!result.ok) this.sending.delete(sessionId);
      respond(result.ok, result.ok ? { sessionId } : undefined, result.ok ? undefined : result.reason === "busy" ? "session busy" : "session unavailable");
    } catch {
      this.sending.delete(sessionId);
      respond(false, undefined, "request failed");
    }
  }

  forwardAgentEvent(event: AgentStreamEvent): void {
    if (this.socket) this.forwardEvent(this.socket, event.sessionId, event);
  }

  private forwardEvent(socket: WebSocket, sessionId: string, event: AgentStreamEvent): void {
    if (socket !== this.socket || !this.ready || !this.watched.has(sessionId) || event.sessionId !== sessionId) return;
    // 明确白名单：不发送工具输入/输出、终端原文、审批请求、推理、错误详情。
    if (event.type === "delta") {
      for (let offset = 0; offset < event.text.length;) {
        let end = Math.min(offset + 2_048, event.text.length);
        if (end < event.text.length && /[\uD800-\uDBFF]/.test(event.text[end - 1]!)) end--;
        this.send(socket, { type: "event", sessionId, event: { type: "delta", text: event.text.slice(offset, end) } });
        offset = end;
      }
    } else if (event.type === "status") {
      this.send(socket, { type: "event", sessionId, event: { type: "status", sessionId, status: event.status } });
    } else if (event.type === "done") {
      this.send(socket, { type: "event", sessionId, event: { type: "done", sessionId, reason: event.reason } });
    }
  }
}
