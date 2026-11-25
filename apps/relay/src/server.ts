import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const UI_DIST = resolve(ROOT, "apps/ui/dist");
const MAX_FRAME = 32_768;
const RPC_TIMEOUT = 15_000;
const COOKIE = "zen_relay";

interface DeviceState { deviceId: string; secretHash: string; name: string; username: string | null; passwordHash: string | null; tokenHash: string | null }
interface SavedState { devices: DeviceState[] }
interface Pending { deviceId: string; resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
interface Browser { deviceId: string; sessionId: string | null }
export interface RelayOptions { stateFile?: string; host?: string; port?: number }

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function equalHash(actual: string | null, value: string): boolean {
  if (!actual || !/^[0-9a-f]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(hash(value), "hex"));
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function json(res: ServerResponse, code: number, body: object): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
function send(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function validOrigin(req: IncomingMessage, required: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) return !required;
  if (typeof origin !== "string" || !req.headers.host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.host === req.headers.host && url.origin === origin;
  } catch { return false; }
}
function cookies(req: IncomingMessage): string | null {
  const entries = (req.headers.cookie ?? "").split(";").map((part) => part.trim());
  const value = entries.find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
async function safeStatePath(path: string): Promise<string> {
  const target = resolve(path);
  let parent = dirname(target);
  while (true) {
    try {
      parent = resolve(await realpath(parent), relative(parent, dirname(target)));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  const existing = await realpath(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return resolve(parent, basename(target));
  });
  const inside = relative(ROOT, existing);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))) {
    throw new Error("Relay state file must be outside the source tree");
  }
  return target;
}
function validId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }
function validAccount(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, Buffer.from(salt, "hex"), 32).toString("hex")}`;
}
function checkPassword(saved: string | null, password: string): boolean {
  if (!saved || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(saved)) return false;
  const [salt, digest] = saved.split(":");
  return timingSafeEqual(Buffer.from(digest!, "hex"), scryptSync(password, Buffer.from(salt!, "hex"), 32));
}
function cursor(url: URL): string | null | undefined {
  const value = url.searchParams.get("cursor");
  return value === null ? undefined : value.length > 0 && value.length <= 512 ? value : null;
}

export async function createRelay(options: RelayOptions = {}) {
  const stateFile = await safeStatePath(options.stateFile ?? process.env.ZEN_RELAY_STATE_FILE ?? join(homedir(), ".zen", "relay", "state.json"));
  let state: SavedState = { devices: [] };
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (!object(parsed)) throw new Error("Invalid relay state file");
    if (Array.isArray(parsed.devices)) {
      if (parsed.devices.length > 32 || !parsed.devices.every((d: unknown) => object(d) && validId(d.deviceId) &&
        typeof d.secretHash === "string" && /^[0-9a-f]{64}$/.test(d.secretHash) && typeof d.name === "string" &&
        (d.username === null || validAccount(d.username)) && (d.passwordHash === null || (typeof d.passwordHash === "string" && /^[0-9a-f]{32}:[0-9a-f]{64}$/.test(d.passwordHash))) &&
        (d.tokenHash === null || (typeof d.tokenHash === "string" && /^[0-9a-f]{64}$/.test(d.tokenHash))))) throw new Error("Invalid relay state file");
      state = { devices: parsed.devices as DeviceState[] };
      if (new Set(state.devices.map((d) => d.deviceId)).size !== state.devices.length) throw new Error("Invalid relay state file");
    } else if (validId(parsed.deviceId) && typeof parsed.secretHash === "string" && /^[0-9a-f]{64}$/.test(parsed.secretHash) &&
      (parsed.tokenHash === null || (typeof parsed.tokenHash === "string" && /^[0-9a-f]{64}$/.test(parsed.tokenHash)))) {
      // Legacy pairing tokens never authenticate against the new login scheme.
      state = { devices: [{ deviceId: parsed.deviceId, secretHash: parsed.secretHash, name: parsed.deviceId, username: null, passwordHash: null, tokenHash: null }] };
    } else throw new Error("Invalid relay state file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let saveQueue = Promise.resolve();
  function save(update: (current: SavedState) => SavedState): Promise<void> {
    const operation = saveQueue.then(async () => {
      const next = update(state);
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${stateFile}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
      if (process.platform !== "win32") await chmod(temporary, 0o600);
      await rename(temporary, stateFile);
      state = next;
    });
    saveQueue = operation.catch(() => undefined);
    return operation;
  }
  function replaceDevice(deviceId: string, patch: Partial<DeviceState>): Promise<void> {
    return save((current) => ({ devices: current.devices.map((d) => d.deviceId === deviceId ? { ...d, ...patch } : d) }));
  }

  const deviceWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const browserWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const devices = new Map<string, WebSocket>();
  const pending = new Map<string, Pending>();
  const attempts = new Map<string, { count: number; until: number }>();
  const browsers = new Map<WebSocket, Browser>();
  let seq = 0;
  const online = (deviceId: string) => devices.get(deviceId)?.readyState === WebSocket.OPEN;
  const authenticated = (req: IncomingMessage) => {
    const token = cookies(req);
    return token ? state.devices.find((d) => equalHash(d.tokenHash, token)) ?? null : null;
  };
  function broadcast(deviceId: string, payload: object, sessionId?: string) {
    for (const [ws, browser] of browsers) if (browser.deviceId === deviceId && (sessionId === undefined || browser.sessionId === sessionId)) send(ws, payload);
  }
  function watch(deviceId: string) {
    const sessionIds = [...new Set([...browsers.values()].filter((b) => b.deviceId === deviceId && b.sessionId !== null).map((b) => b.sessionId!))];
    const ws = devices.get(deviceId);
    if (ws) send(ws, { type: "watch", sessionIds });
  }
  function closeBrowsers(deviceId: string) {
    let closed = false;
    for (const [ws, info] of browsers) if (info.deviceId === deviceId) {
      browsers.delete(ws);
      ws.close(1008);
      closed = true;
    }
    if (closed) watch(deviceId);
  }
  function dropDevice(deviceId: string, ws: WebSocket) {
    if (devices.get(deviceId) !== ws) return;
    devices.delete(deviceId);
    for (const [id, task] of pending) if (task.deviceId === deviceId) {
      clearTimeout(task.timer);
      task.reject(new Error("device offline"));
      pending.delete(id);
    }
    broadcast(deviceId, { type: "status", online: false });
  }
  function rpc(deviceId: string, action: string, fields: Record<string, string> = {}): Promise<unknown> {
    const ws = devices.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("device offline"));
    const id = randomBytes(16).toString("hex");
    return new Promise((resolveTask, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("device timeout")); }, RPC_TIMEOUT);
      pending.set(id, { deviceId, resolve: resolveTask, reject, timer });
      send(ws, { type: "request", id, action, ...fields });
    });
  }
  function onDevice(ws: WebSocket) {
    let deviceId: string | null = null;
    let authenticating = false;
    const helloTimer = setTimeout(() => ws.close(1008), 5_000);
    ws.on("message", (raw: RawData, binary: boolean) => {
      if (binary) { ws.close(1003); return; }
      let frame: unknown;
      try { frame = JSON.parse(raw.toString()); } catch { ws.close(1007); return; }
      if (!object(frame)) { ws.close(1007); return; }
      if (!deviceId) {
        if (authenticating || frame.type !== "hello" || !validId(frame.deviceId) || typeof frame.secret !== "string" || !/^[0-9a-f]{64}$/.test(frame.secret) ||
          !validId(frame.name) || !validAccount(frame.username) || !validAccount(frame.password)) { ws.close(1008); return; }
        authenticating = true;
        const hello = frame;
        let accountChanged = false;
        void save((current) => {
          const existing = current.devices.find((d) => d.deviceId === hello.deviceId);
          if (existing && !equalHash(existing.secretHash, hello.secret as string)) throw new Error("invalid secret");
          if (!existing && current.devices.length >= 32) throw new Error("device limit reached");
          accountChanged = !!existing && (existing.username !== hello.username || !checkPassword(existing.passwordHash, hello.password as string));
          const next: DeviceState = { deviceId: hello.deviceId as string, secretHash: existing?.secretHash ?? hash(hello.secret as string),
            name: hello.name as string, username: hello.username as string, passwordHash: passwordHash(hello.password as string), tokenHash: accountChanged ? null : existing?.tokenHash ?? null };
          return { devices: existing ? current.devices.map((d) => d.deviceId === next.deviceId ? next : d) : [...current.devices, next] };
        }).then(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          deviceId = hello.deviceId as string;
          if (accountChanged) closeBrowsers(deviceId);
          const previous = devices.get(deviceId);
          if (previous && previous !== ws) { dropDevice(deviceId, previous); previous.close(1008); }
          devices.set(deviceId, ws);
          clearTimeout(helloTimer);
          send(ws, { type: "ready" });
          broadcast(deviceId, { type: "status", online: true });
          watch(deviceId);
        }).catch(() => ws.close(1008));
        return;
      }
      if (devices.get(deviceId) !== ws) return;
      if (frame.type === "device.rotate" && typeof frame.secret === "string" && /^[0-9a-f]{64}$/.test(frame.secret)) {
        const id = deviceId;
        void replaceDevice(id, { secretHash: hash(frame.secret), tokenHash: null }).then(() => {
          closeBrowsers(id);
          send(ws, { type: "device.rotated" });
        }).catch(() => send(ws, { type: "error", error: "rotation failed" }));
      } else if (frame.type === "response" && typeof frame.id === "string" && typeof frame.ok === "boolean") {
        const task = pending.get(frame.id);
        if (!task || task.deviceId !== deviceId) return;
        pending.delete(frame.id);
        clearTimeout(task.timer);
        if (frame.ok) task.resolve(frame.data);
        else task.reject(new Error(typeof frame.error === "string" ? frame.error : "device rejected request"));
      } else if (frame.type === "event" && validId(frame.sessionId) && object(frame.event) &&
        ["delta", "status", "done"].includes(String(frame.event.type))) {
        const event = frame.event;
        let safeEvent: object;
        if (event.type === "delta" && typeof event.text === "string") safeEvent = { type: "delta", text: event.text.slice(0, 2_048) };
        else if (event.type === "status" && typeof event.status === "string") safeEvent = { type: "status", status: event.status.slice(0, 64) };
        else if (event.type === "done") safeEvent = { type: "done" };
        else return;
        if ([...browsers.values()].some((b) => b.deviceId === deviceId && b.sessionId === frame.sessionId))
          broadcast(deviceId, { type: "event", seq: ++seq, sessionId: frame.sessionId, event: safeEvent }, frame.sessionId);
      }
    });
    ws.on("close", () => { clearTimeout(helloTimer); if (deviceId) dropDevice(deviceId, ws); });
    ws.on("error", () => ws.close());
  }
  deviceWss.on("connection", onDevice);
  browserWss.on("connection", (ws, req: IncomingMessage) => {
    const device = authenticated(req);
    if (!device) { ws.close(1008); return; }
    closeBrowsers(device.deviceId);
    browsers.set(ws, { deviceId: device.deviceId, sessionId: null });
    send(ws, { type: "status", online: online(device.deviceId) });
    ws.on("message", (raw: RawData, binary: boolean) => {
      let frame: unknown;
      try { frame = JSON.parse(raw.toString()); } catch { ws.close(1007); return; }
      if (binary || !object(frame) || frame.type !== "subscribe" || (frame.sessionId !== null && !validId(frame.sessionId))) { ws.close(1008); return; }
      const browser = browsers.get(ws);
      if (!browser) return;
      browser.sessionId = frame.sessionId as string | null;
      watch(browser.deviceId);
    });
    ws.on("close", () => { const info = browsers.get(ws); browsers.delete(ws); if (info) watch(info.deviceId); });
    ws.on("error", () => ws.close());
  });

  async function body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > MAX_FRAME) throw new Error("body too large");
      chunks.push(part);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = req.method;
    if (!validOrigin(req, method === "POST")) { json(res, 403, { error: "invalid origin" }); return; }
    if (method === "POST" && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
      json(res, 415, { error: "unsupported content type" }); return;
    }
    if (pathname === "/api/devices" && method === "GET") {
      json(res, 200, { devices: state.devices.map((d) => ({ id: d.deviceId, name: d.name, online: online(d.deviceId) })) }); return;
    }
    const device = authenticated(req);
    if (pathname === "/api/status" && method === "GET") {
      json(res, 200, { online: device ? online(device.deviceId) : false, paired: device !== null, deviceId: device?.deviceId ?? null }); return;
    }
    if (pathname === "/api/login" && method === "POST") {
      const key = req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      let limit = attempts.get(key);
      if (!limit || limit.until <= now) { limit = { count: 0, until: now + 60_000 }; attempts.set(key, limit); }
      if (++limit.count > 5) { json(res, 429, { error: "too many attempts" }); return; }
      let input: unknown;
      try { input = await body(req); }
      catch (error) { json(res, error instanceof Error && error.message === "body too large" ? 413 : 400, { error: "invalid request" }); return; }
      if (!object(input) || !validId(input.deviceId) || !validAccount(input.username) || !validAccount(input.password)) {
        json(res, 400, { error: "invalid request" }); return;
      }
      const target = state.devices.find((d) => d.deviceId === input.deviceId);
      if (!target || target.username !== input.username || !checkPassword(target.passwordHash, input.password)) {
        json(res, 403, { error: "invalid credentials" }); return;
      }
      const token = randomBytes(32).toString("hex");
      await replaceDevice(target.deviceId, { tokenHash: hash(token) });
      closeBrowsers(target.deviceId);
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`);
      json(res, 200, { ok: true }); return;
    }
    if (pathname === "/api/logout" && method === "POST") {
      if (device) {
        await replaceDevice(device.deviceId, { tokenHash: null });
        closeBrowsers(device.deviceId);
      }
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      json(res, 200, { ok: true }); return;
    }
    const match = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(pathname);
    if (pathname === "/api/sessions" || match) {
      if (!device) { json(res, 401, { error: "unauthorized" }); return; }
      if (!online(device.deviceId)) { json(res, 503, { error: "device offline" }); return; }
      const pageCursor = cursor(url);
      if (pageCursor === null) { json(res, 400, { error: "invalid cursor" }); return; }
      try {
        if (pathname === "/api/sessions" && method === "GET") {
          const data = await rpc(device.deviceId, "sessions.list", pageCursor ? { cursor: pageCursor } : {});
          const groups = Array.isArray(data) ? data : object(data) && Array.isArray(data.groups) ? data.groups : [];
          const rawSessions = object(data) && Array.isArray(data.sessions) ? data.sessions : groups.flatMap((group: unknown) =>
            object(group) && Array.isArray(group.sessions) ? group.sessions : []);
          const workspaces = object(data) && Array.isArray(data.workspaces) ? data.workspaces : groups.map((group: unknown) => object(group) ? group.workspace : null).filter(object);
          const sessions = rawSessions.filter((s: unknown) => object(s) && validId(s.id)).map((s: Record<string, unknown>) => ({
            id: s.id, title: s.title, state: s.state ?? (s.archived ? "archived" : "idle"), updatedAt: s.updatedAt, workspaceId: s.workspaceId,
          }));
          json(res, 200, { sessions, workspaces: workspaces.filter(object).map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
            ...(object(data) && typeof data.nextCursor === "string" ? { nextCursor: data.nextCursor } : {}) }); return;
        }
        if (pathname === "/api/sessions" && method === "POST") {
          const input = await body(req);
          if (!object(input) || !validId(input.workspaceId)) { json(res, 400, { error: "invalid workspace" }); return; }
          const data = await rpc(device.deviceId, "sessions.create", { workspaceId: input.workspaceId });
          json(res, 200, object(data) ? data : { session: data }); return;
        }
        if (match) {
          const sessionId = decodeURIComponent(match[1]!);
          if (!validId(sessionId) || sessionId.includes("/")) { json(res, 400, { error: "invalid session" }); return; }
          if (!match[2] && method === "GET") {
            const data = await rpc(device.deviceId, "sessions.get", { sessionId, ...(pageCursor ? { cursor: pageCursor } : {}) });
            if (!object(data) || !object(data.session) || !Array.isArray(data.messages)) throw new Error("invalid device response");
            const session = data.session;
            json(res, 200, { session: { id: session.id, title: session.title, state: session.state ?? "idle" },
              messages: data.messages.filter((m: unknown) => object(m) && (m.role === "user" || m.role === "assistant"))
                .map((m: Record<string, unknown>) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
                  ...(Number.isSafeInteger(m.offset) && Number.isSafeInteger(m.totalLength) ? { offset: m.offset, totalLength: m.totalLength } : {}),
                })),
              ...(typeof data.nextCursor === "string" ? { nextCursor: data.nextCursor } : {}) }); return;
          }
          if (match[2] && method === "POST") {
            const input = await body(req);
            if (!object(input) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 8_000) {
              json(res, 400, { error: "invalid message" }); return;
            }
            await rpc(device.deviceId, "message.send", { sessionId, text: input.text });
            json(res, 200, { ok: true }); return;
          }
        }
      } catch (error) {
        json(res, error instanceof SyntaxError ? 400 : error instanceof Error && error.message === "body too large" ? 413 : 503,
          { error: "request unavailable" }); return;
      }
    }
    if (method === "GET" && (pathname === "/" || pathname === "/remote.html" || pathname.startsWith("/assets/"))) {
      const asset = pathname === "/" ? "/remote.html" : pathname;
      let decoded: string;
      try { decoded = decodeURIComponent(asset); } catch { json(res, 400, { error: "invalid path" }); return; }
      const file = resolve(UI_DIST, `.${decoded}`);
      const relativePath = relative(UI_DIST, file);
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath) || decoded.includes("\\")) {
        json(res, 404, { error: "not found" }); return;
      }
      try {
        const actual = await realpath(file);
        const contained = relative(UI_DIST, actual);
        if (!contained || contained.startsWith("..") || isAbsolute(contained)) throw new Error("outside UI assets");
        const info = await stat(actual);
        if (!info.isFile()) throw new Error("not a file");
        const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };
        res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" });
        createReadStream(file).pipe(res); return;
      } catch { json(res, 404, { error: "not found" }); return; }
    }
    json(res, 404, { error: "not found" });
  }
  const server = createServer((req, res) => {
    void route(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: "request failed" }); else res.destroy(); });
  });
  server.on("upgrade", (req, socket, head) => {
    const path = req.url;
    const browser = path === "/ws/browser";
    if ((path !== "/ws/device" && !browser) || !validOrigin(req, browser) || (browser && !authenticated(req))) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const wss = browser ? browserWss : deviceWss;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  return {
    server,
    listen: () => new Promise<number>((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 8787, options.host ?? "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        resolvePort(typeof address === "object" && address ? address.port : 0);
      });
    }),
    close: async () => {
      for (const ws of browsers.keys()) ws.terminate();
      for (const ws of devices.values()) ws.terminate();
      deviceWss.close(); browserWss.close();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("relay closing")); }
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
