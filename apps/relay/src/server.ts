import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
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
const PAIR_LIFETIME = 600_000;
const RPC_TIMEOUT = 15_000;
const COOKIE = "zen_relay";

interface SavedState { deviceId: string; secretHash: string; tokenHash: string | null }
interface Pending { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
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

export async function createRelay(options: RelayOptions = {}) {
  const stateFile = await safeStatePath(options.stateFile ?? process.env.ZEN_RELAY_STATE_FILE ?? join(homedir(), ".zen", "relay", "state.json"));
  let state: SavedState | null = null;
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (!object(parsed) || typeof parsed.deviceId !== "string" || !parsed.deviceId ||
      typeof parsed.secretHash !== "string" || !/^[0-9a-f]{64}$/.test(parsed.secretHash) ||
      (parsed.tokenHash !== null && (typeof parsed.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(parsed.tokenHash)))) {
      throw new Error("Invalid relay state file");
    }
    state = { deviceId: parsed.deviceId, secretHash: parsed.secretHash, tokenHash: parsed.tokenHash };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let saveQueue = Promise.resolve();
  function save(next: SavedState): Promise<void> {
    const operation = saveQueue.then(async () => {
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

  const deviceWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const browserWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  let device: WebSocket | null = null;
  let claiming = false;
  let rotating = false;
  let code: { value: string; expiresAt: number } | null = null;
  let lastCodeAt = 0;
  let seq = 0;
  const pending = new Map<string, Pending>();
  const attempts = new Map<string, { count: number; until: number }>();
  const browsers = new Set<WebSocket>();
  const online = () => device?.readyState === WebSocket.OPEN;
  const paired = (req: IncomingMessage) => {
    const token = cookies(req);
    return token !== null && equalHash(state?.tokenHash ?? null, token);
  };
  function broadcast(payload: object) { for (const ws of browsers) send(ws, payload); }
  function dropDevice(ws: WebSocket) {
    if (device !== ws) return;
    device = null;
    code = null;
    for (const [id, task] of pending) {
      clearTimeout(task.timer);
      task.reject(new Error("device offline"));
      pending.delete(id);
    }
    broadcast({ type: "status", online: false });
  }
  function rpc(action: string, sessionId?: string, text?: string): Promise<unknown> {
    if (!online() || !device) return Promise.reject(new Error("device offline"));
    const id = randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("device timeout"));
      }, RPC_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      send(device!, { type: "request", id, action, ...(sessionId ? { sessionId } : {}), ...(text ? { text } : {}) });
    });
  }
  function onDevice(ws: WebSocket) {
    let ready = false;
    const helloTimer = setTimeout(() => ws.close(1008), 5_000);
    ws.on("message", (raw: RawData, binary: boolean) => {
      if (binary) { ws.close(1003); return; }
      let frame: unknown;
      try { frame = JSON.parse(raw.toString()); } catch { ws.close(1007); return; }
      if (!object(frame)) { ws.close(1007); return; }
      if (!ready) {
        if (frame.type !== "hello" || typeof frame.deviceId !== "string" || !frame.deviceId || frame.deviceId.length > 128 ||
          typeof frame.secret !== "string" || !/^[0-9a-f]{64}$/.test(frame.secret)) { ws.close(1008); return; }
        // The first device claims this relay; subsequent connections must prove the same secret.
        const authenticate = async () => {
          if (rotating) { ws.close(1008); return; }
          if (state && (state.deviceId !== frame.deviceId || !equalHash(state.secretHash, frame.secret as string))) {
            ws.close(1008); return;
          }
          if (!state) {
            if (claiming) { ws.close(1008); return; }
            claiming = true;
            try { await save({ deviceId: frame.deviceId as string, secretHash: hash(frame.secret as string), tokenHash: null }); }
            finally { claiming = false; }
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          if (device && device !== ws) { const previous = device; dropDevice(previous); previous.close(1008); }
          device = ws;
          ready = true;
          clearTimeout(helloTimer);
          send(ws, { type: "ready" });
          broadcast({ type: "status", online: true });
        };
        void authenticate().catch(() => ws.close(1011));
        return;
      }
      if (device !== ws) return;
      if (frame.type === "pair.request") {
        if (rotating) { send(ws, { type: "error", error: "rotation in progress" }); return; }
        if (Date.now() - lastCodeAt < 30_000) { send(ws, { type: "error", error: "pairing rate limited" }); return; }
        lastCodeAt = Date.now();
        code = { value: String(randomInt(0, 1_000_000)).padStart(6, "0"), expiresAt: Date.now() + PAIR_LIFETIME };
        send(ws, { type: "pair.code", code: code.value, expiresAt: code.expiresAt });
      } else if (frame.type === "device.rotate" && typeof frame.secret === "string" && /^[0-9a-f]{64}$/.test(frame.secret) && !rotating) {
        rotating = true;
        code = null;
        void save({ deviceId: state!.deviceId, secretHash: hash(frame.secret), tokenHash: null })
          .then(() => {
            for (const browser of browsers) browser.close(1008);
            send(ws, { type: "device.rotated" });
          })
          .catch(() => send(ws, { type: "error", error: "rotation failed" }))
          .finally(() => { rotating = false; });
      } else if (frame.type === "response" && typeof frame.id === "string" && typeof frame.ok === "boolean") {
        const task = pending.get(frame.id);
        if (!task) return;
        pending.delete(frame.id);
        clearTimeout(task.timer);
        if (frame.ok) task.resolve(frame.data);
        else task.reject(new Error(typeof frame.error === "string" ? frame.error : "device rejected request"));
      } else if (frame.type === "event" && typeof frame.sessionId === "string" && frame.sessionId.length <= 128 && object(frame.event) &&
        ["delta", "status", "done"].includes(String(frame.event.type))) {
        // Never forward arbitrary device fields to a browser.
        const event = frame.event;
        let safeEvent: object;
        if (event.type === "delta" && typeof event.text === "string") safeEvent = { type: "delta", text: event.text.slice(0, 2_048) };
        else if (event.type === "status" && typeof event.status === "string") safeEvent = { type: "status", status: event.status.slice(0, 64) };
        else if (event.type === "done") safeEvent = { type: "done" };
        else return;
        broadcast({ type: "event", seq: ++seq, sessionId: frame.sessionId, event: safeEvent });
      }
    });
    ws.on("close", () => { clearTimeout(helloTimer); dropDevice(ws); });
    ws.on("error", () => ws.close());
  }
  deviceWss.on("connection", onDevice);
  browserWss.on("connection", (ws) => {
    for (const previous of browsers) previous.close(1008);
    browsers.add(ws);
    send(ws, { type: "status", online: online() });
    ws.on("message", () => ws.close(1008));
    ws.on("close", () => browsers.delete(ws));
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
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const method = req.method;
    if (!validOrigin(req, method === "POST")) { json(res, 403, { error: "invalid origin" }); return; }
    if (method === "POST" && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
      json(res, 415, { error: "unsupported content type" }); return;
    }
    if (pathname === "/api/status" && method === "GET") {
      json(res, 200, { online: online(), paired: paired(req) }); return;
    }
    if (pathname === "/api/pair" && method === "POST") {
      const ip = req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      let limit = attempts.get(ip);
      if (!limit || limit.until <= now) { limit = { count: 0, until: now + PAIR_LIFETIME }; attempts.set(ip, limit); }
      if (++limit.count > 5) { json(res, 429, { error: "too many attempts" }); return; }
      let input: unknown;
      try { input = await body(req); }
      catch (error) {
        json(res, error instanceof Error && error.message === "body too large" ? 413 : 400, { error: "invalid request" });
        return;
      }
      if (!object(input) || typeof input.code !== "string" || !/^\d{6}$/.test(input.code) ||
        !code || code.expiresAt <= now || !online() || !timingSafeEqual(Buffer.from(input.code), Buffer.from(code.value))) {
        json(res, 403, { error: "invalid code" }); return;
      }
      code = null;
      const token = randomBytes(32).toString("hex");
      await save({ ...state!, tokenHash: hash(token) });
      for (const ws of browsers) ws.close(1008);
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`);
      json(res, 200, { paired: true }); return;
    }
    const match = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(pathname);
    if (pathname === "/api/sessions" || match) {
      if (!paired(req)) { json(res, 401, { error: "unauthorized" }); return; }
      if (!online()) { json(res, 503, { error: "device offline" }); return; }
      try {
        if (pathname === "/api/sessions" && method === "GET") {
          const groups = await rpc("sessions.list");
          const sessions = Array.isArray(groups) ? groups.flatMap((group: unknown) =>
            object(group) && Array.isArray(group.sessions) ? group.sessions : []) : [];
          json(res, 200, { sessions: sessions.filter((s: unknown) => object(s) && typeof s.id === "string").map((s: Record<string, unknown>) => ({
            id: s.id, title: s.title, state: s.state ?? (s.archived ? "archived" : "idle"), updatedAt: s.updatedAt,
          })) }); return;
        }
        if (match) {
          const sessionId = decodeURIComponent(match[1]!);
          if (!sessionId || sessionId.length > 128 || sessionId.includes("/")) { json(res, 400, { error: "invalid session" }); return; }
          if (!match[2] && method === "GET") {
            const data = await rpc("sessions.get", sessionId);
            if (!object(data) || !object(data.session) || !Array.isArray(data.messages)) throw new Error("invalid device response");
            const session = data.session;
            json(res, 200, { session: { id: session.id, title: session.title, state: session.state ?? "idle" },
              messages: data.messages.filter((m: unknown) => object(m) && (m.role === "user" || m.role === "assistant"))
                .map((m: Record<string, unknown>) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })) }); return;
          }
          if (match[2] && method === "POST") {
            const input = await body(req);
            if (!object(input) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 8_000) {
              json(res, 400, { error: "invalid message" }); return;
            }
            await rpc("message.send", sessionId, input.text);
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
    if ((path !== "/ws/device" && !browser) || !validOrigin(req, browser) || (browser && !paired(req))) {
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
      for (const ws of browsers) ws.terminate();
      device?.terminate();
      deviceWss.close(); browserWss.close();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("relay closing")); }
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
