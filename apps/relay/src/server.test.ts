import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRelay } from "./server.js";

async function fixture(initial?: object) {
  const dir = await mkdtemp(join(tmpdir(), "zen-relay-test-"));
  const stateFile = join(dir, "state.json");
  if (initial) await writeFile(stateFile, JSON.stringify(initial));
  const relay = await createRelay({ stateFile, port: 0 });
  const url = `http://127.0.0.1:${await relay.listen()}`;
  return { relay, stateFile, url, cleanup: async () => { await relay.close(); await rm(dir, { recursive: true, force: true }); } };
}
const inbox = new WeakMap<WebSocket, { frames: Record<string, unknown>[]; waiting: Array<(frame: Record<string, unknown>) => void> }>();
async function socket(url: string, path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url.replace("http:", "ws:") + path, { headers });
  const queue = { frames: [] as Record<string, unknown>[], waiting: [] as Array<(frame: Record<string, unknown>) => void> };
  inbox.set(ws, queue);
  ws.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    const resolveFrame = queue.waiting.shift();
    if (resolveFrame) resolveFrame(frame);
    else queue.frames.push(frame);
  });
  await once(ws, "open");
  return ws;
}
function next(ws: WebSocket): Promise<Record<string, unknown>> {
  const queue = inbox.get(ws)!;
  const frame = queue.frames.shift();
  return frame ? Promise.resolve(frame) : new Promise((resolveFrame) => queue.waiting.push(resolveFrame));
}
async function device(url: string, id: string, secret = randomBytes(32).toString("hex"), name = id, username = id, password = `password-${id}`) {
  const ws = await socket(url, "/ws/device");
  const ready = next(ws);
  ws.send(JSON.stringify({ type: "hello", deviceId: id, secret, name, username, password }));
  assert.equal((await ready).type, "ready");
  assert.deepEqual(await next(ws), { type: "watch", sessionIds: [] });
  return { ws, secret, id, username, password };
}
async function login(url: string, id: string, username = id, password = `password-${id}`) {
  const response = await fetch(url + "/api/login", { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: JSON.stringify({ deviceId: id, username, password }) });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie")!;
  assert.match(header, /Secure; HttpOnly; SameSite=Strict/);
  return header.split(";")[0]!;
}
async function respond(ws: WebSocket, request: Promise<Record<string, unknown>>, data: object) {
  const frame = await request;
  ws.send(JSON.stringify({ type: "response", id: frame.id, ok: true, data }));
  return frame;
}

test("multiple devices persist salted hashes, reject ID hijack, and expose only public fields", async () => {
  const f = await fixture();
  try {
    const a = await device(f.url, "a", undefined, "Laptop");
    const b = await device(f.url, "b", undefined, "Desktop");
    assert.deepEqual(await (await fetch(f.url + "/api/devices")).json(), { devices: [
      { id: "a", name: "Laptop", online: true }, { id: "b", name: "Desktop", online: true },
    ] });
    const saved = await readFile(f.stateFile, "utf8");
    assert.ok(!saved.includes(a.secret) && !saved.includes(a.password) && !saved.includes(b.password));
    assert.match(saved, /"passwordHash":"[0-9a-f]{32}:[0-9a-f]{64}"/);
    if (process.platform !== "win32") assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600);
    const rogue = await socket(f.url, "/ws/device");
    const closed = once(rogue, "close");
    rogue.send(JSON.stringify({ type: "hello", deviceId: "a", secret: b.secret, name: "Stolen", username: "bad", password: "bad" }));
    await closed;
    assert.equal(((await (await fetch(f.url + "/api/devices")).json()) as { devices: Array<{ name: string }> }).devices[0]?.name, "Laptop");
    await f.relay.close();
    const restarted = await createRelay({ stateFile: f.stateFile, port: 0 });
    try {
      const url = `http://127.0.0.1:${await restarted.listen()}`;
      await device(url, "a", a.secret, "Laptop");
      assert.equal((await fetch(url + "/api/devices")).status, 200);
    } finally { await restarted.close(); }
  } finally { await rm(join(f.stateFile, ".."), { recursive: true, force: true }); }
});

test("legacy state migrates without honoring old pairing cookie; old pair endpoint is disabled", async () => {
  const secret = randomBytes(32).toString("hex");
  const token = randomBytes(32).toString("hex");
  const f = await fixture({ deviceId: "legacy", secretHash: createHash("sha256").update(secret).digest("hex"), tokenHash: createHash("sha256").update(token).digest("hex") });
  try {
    assert.equal((await fetch(f.url + "/api/sessions", { headers: { cookie: `zen_relay=${token}` } })).status, 401);
    assert.equal((await fetch(f.url + "/api/pair", { method: "POST", headers: { origin: f.url, "content-type": "application/json" }, body: "{}" })).status, 404);
    await device(f.url, "legacy", secret);
    const saved = JSON.parse(await readFile(f.stateFile, "utf8"));
    assert.equal(saved.devices[0].secretHash, createHash("sha256").update(secret).digest("hex"));
    assert.equal(saved.devices[0].tokenHash, null);
    assert.equal((await fetch(f.url + "/api/sessions", { headers: { cookie: `zen_relay=${token}` } })).status, 401);
    assert.equal((await fetch(f.url + "/api/status", { headers: { cookie: await login(f.url, "legacy") } })).status, 200);
  } finally { await f.cleanup(); }
});

test("login limits failures, routes RPC to cookie device, supports cursors and create", async () => {
  const f = await fixture();
  try {
    const a = await device(f.url, "a");
    const b = await device(f.url, "b");
    const bad = () => fetch(f.url + "/api/login", { method: "POST", headers: { origin: f.url, "content-type": "application/json" }, body: JSON.stringify({ deviceId: "a", username: "a", password: "wrong" }) });
    assert.equal((await bad()).status, 403);
    const cookie = await login(f.url, "a");
    assert.deepEqual(await (await fetch(f.url + "/api/status", { headers: { cookie } })).json(), { online: true, paired: true, deviceId: "a" });
    const listFrame = next(a.ws);
    const list = fetch(f.url + "/api/sessions?cursor=page2", { headers: { cookie } });
    assert.deepEqual(await respond(a.ws, listFrame, { sessions: [{ id: "s1", title: "Hello", workspaceId: "w", private: "SECRET" }], workspaces: [{ id: "w", name: "Project", secret: "SECRET" }], nextCursor: "page3" }),
      { type: "request", id: (await listFrame).id, action: "sessions.list", cursor: "page2" });
    assert.deepEqual(await (await list).json(), { sessions: [{ id: "s1", title: "Hello", state: "idle", workspaceId: "w" }], workspaces: [{ id: "w", name: "Project" }], nextCursor: "page3" });
    const createFrame = next(a.ws);
    const creating = fetch(f.url + "/api/sessions", { method: "POST", headers: { cookie, origin: f.url, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "w" }) });
    assert.equal((await respond(a.ws, createFrame, { session: { id: "s2" } })).action, "sessions.create");
    assert.deepEqual(await (await creating).json(), { session: { id: "s2" } });
    const detailFrame = next(a.ws);
    const detail = fetch(f.url + "/api/sessions/s1?cursor=m2", { headers: { cookie } });
    const request = await respond(a.ws, detailFrame, { session: { id: "s1", title: "Hello", private: "SECRET" }, messages: [{ id: "m", role: "assistant", content: "hi", offset: 4, totalLength: 6, secret: "SECRET" }], nextCursor: "m3" });
    assert.equal(request.cursor, "m2");
    assert.equal(request.sessionId, "s1");
    assert.deepEqual(await (await detail).json(), { session: { id: "s1", title: "Hello", state: "idle" }, messages: [{ id: "m", role: "assistant", content: "hi", offset: 4, totalLength: 6 }], nextCursor: "m3" });
    const sentFrame = next(a.ws);
    const sending = fetch(f.url + "/api/sessions/s1/messages", { method: "POST", headers: { cookie, origin: f.url, "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
    assert.equal((await respond(a.ws, sentFrame, {})).action, "message.send");
    assert.equal((await sending).status, 200);
    const cookieB = await login(f.url, "b");
    for (let i = 0; i < 2; i++) assert.equal((await bad()).status, 403);
    assert.equal((await bad()).status, 429);
    assert.equal((await fetch(f.url + "/api/sessions?cursor=", { headers: { cookie } })).status, 400);
    b.ws.close();
    await once(b.ws, "close");
    assert.equal((await fetch(f.url + "/api/sessions", { headers: { cookie: cookieB } })).status, 503);
  } finally { await f.cleanup(); }
});

test("browser subscription routes only selected session and device; disconnect unwatches", async () => {
  const f = await fixture();
  try {
    const a = await device(f.url, "a");
    const b = await device(f.url, "b");
    const cookieA = await login(f.url, "a");
    const cookieB = await login(f.url, "b");
    const browserA = await socket(f.url, "/ws/browser", { cookie: cookieA, origin: f.url });
    const browserB = await socket(f.url, "/ws/browser", { cookie: cookieB, origin: f.url });
    assert.deepEqual(await next(browserA), { type: "status", online: true });
    assert.deepEqual(await next(browserB), { type: "status", online: true });
    const watchA = next(a.ws);
    browserA.send(JSON.stringify({ type: "subscribe", sessionId: "same" }));
    assert.deepEqual(await watchA, { type: "watch", sessionIds: ["same"] });
    const watchB = next(b.ws);
    browserB.send(JSON.stringify({ type: "subscribe", sessionId: "same" }));
    assert.deepEqual(await watchB, { type: "watch", sessionIds: ["same"] });
    const eventA = next(browserA);
    a.ws.send(JSON.stringify({ type: "event", sessionId: "same", event: { type: "delta", text: "a", secret: "SECRET" } }));
    assert.deepEqual(await eventA, { type: "event", seq: 1, sessionId: "same", event: { type: "delta", text: "a" } });
    const eventB = next(browserB);
    b.ws.send(JSON.stringify({ type: "event", sessionId: "same", event: { type: "done" } }));
    assert.deepEqual(await eventB, { type: "event", seq: 2, sessionId: "same", event: { type: "done" } });
    const stop = next(a.ws);
    browserA.send(JSON.stringify({ type: "subscribe", sessionId: null }));
    assert.deepEqual(await stop, { type: "watch", sessionIds: [] });
    a.ws.send(JSON.stringify({ type: "event", sessionId: "same", event: { type: "done" } }));
    const stopB = next(b.ws);
    browserB.close();
    assert.deepEqual(await stopB, { type: "watch", sessionIds: [] });
    browserA.close();
  } finally { await f.cleanup(); }
});

test("origin, frame/body limits, state path, and unauthorized requests fail closed", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url + "/api/sessions")).status, 401);
    assert.equal((await fetch(f.url + "/api/login", { method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(f.url + "/api/login", { method: "POST", headers: { origin: f.url, "content-type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await fetch(f.url + "/index.html")).status, 404);
    assert.equal((await fetch(f.url + "/remote.html")).status, 200);
    await assert.rejects(createRelay({ stateFile: resolve("apps/relay/state.json") }));
    await assert.rejects(socket(f.url, "/ws/browser", { origin: f.url }));
    await assert.rejects(socket(f.url, "/ws/device?secret=x"));
  } finally { await f.cleanup(); }
});
