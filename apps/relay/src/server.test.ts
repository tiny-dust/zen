import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRelay } from "./server.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zen-relay-test-"));
  const stateFile = join(dir, "state.json");
  const relay = await createRelay({ stateFile, port: 0 });
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;
  return { relay, stateFile, url, cleanup: async () => { await relay.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function socket(url: string, path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url.replace("http:", "ws:") + path, { headers });
  await once(ws, "open");
  return ws;
}
function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveFrame, reject) => {
    ws.once("message", (raw) => {
      try { resolveFrame(JSON.parse(raw.toString())); } catch (error) { reject(error); }
    });
  });
}
async function device(url: string, secret = randomBytes(32).toString("hex")) {
  const ws = await socket(url, "/ws/device");
  const frame = next(ws);
  ws.send(JSON.stringify({ type: "hello", deviceId: "device-1", secret }));
  assert.equal((await frame).type, "ready");
  return { ws, secret };
}
async function pair(url: string, ws: WebSocket) {
  const frame = next(ws);
  ws.send(JSON.stringify({ type: "pair.request" }));
  const result = await frame;
  assert.equal(result.type, "pair.code");
  const response = await fetch(url + "/api/pair", { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: JSON.stringify({ code: result.code }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  return cookie.split(";")[0]!;
}

test("hello claims a single device; hashed credentials persist with private permissions", async () => {
  const f = await fixture();
  try {
    const secret = randomBytes(32).toString("hex");
    const first = await device(f.url, secret);
    const saved = await readFile(f.stateFile, "utf8");
    assert.ok(!saved.includes(secret));
    if (process.platform !== "win32") assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600);
    const wrong = await socket(f.url, "/ws/device");
    const closed = once(wrong, "close");
    wrong.send(JSON.stringify({ type: "hello", deviceId: "device-1", secret: randomBytes(32).toString("hex") }));
    await closed;
    assert.equal(((await (await fetch(f.url + "/api/status")).json()) as { online: boolean }).online, true);
    first.ws.close();
    await once(first.ws, "close");
    await f.relay.close();
    const restarted = await createRelay({ stateFile: f.stateFile, port: 0 });
    try {
      const port = await restarted.listen();
      const ws = await device(`http://127.0.0.1:${port}`, secret);
      ws.ws.close();
      await once(ws.ws, "close");
    } finally { await restarted.close(); }
  } finally { await rm(join(f.stateFile, ".."), { recursive: true, force: true }); }
});

test("pairing is one-use, browser cookie is hashed and survives restart", async () => {
  const f = await fixture();
  try {
    const d = await device(f.url);
    const cookie = await pair(f.url, d.ws);
    assert.ok(!(await readFile(f.stateFile, "utf8")).includes(cookie.split("=")[1]!));
    assert.deepEqual(await (await fetch(f.url + "/api/status", { headers: { cookie } })).json(), { online: true, paired: true });
    const reused = await fetch(f.url + "/api/pair", { method: "POST", headers: { origin: f.url, "content-type": "application/json" }, body: JSON.stringify({ code: "000000" }) });
    assert.equal(reused.status, 403);
    await f.relay.close();
    const restarted = await createRelay({ stateFile: f.stateFile, port: 0 });
    try {
      const port = await restarted.listen();
      assert.equal(((await (await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { cookie } })).json()) as { paired: boolean }).paired, true);
    } finally { await restarted.close(); }
  } finally { await rm(join(f.stateFile, ".."), { recursive: true, force: true }); }
});

test("revoke rotates the device secret and invalidates browser pairing across restart", async () => {
  const f = await fixture();
  try {
    const oldSecret = randomBytes(32).toString("hex");
    const d = await device(f.url, oldSecret);
    const cookie = await pair(f.url, d.ws);
    const rotated = next(d.ws);
    const newSecret = randomBytes(32).toString("hex");
    d.ws.send(JSON.stringify({ type: "device.rotate", secret: newSecret }));
    assert.deepEqual(await rotated, { type: "device.rotated" });
    assert.deepEqual(await (await fetch(f.url + "/api/status", { headers: { cookie } })).json(), { online: true, paired: false });
    const wrong = await socket(f.url, "/ws/device");
    const closed = once(wrong, "close");
    wrong.send(JSON.stringify({ type: "hello", deviceId: "device-1", secret: oldSecret }));
    await closed;
    await f.relay.close();
    const restarted = await createRelay({ stateFile: f.stateFile, port: 0 });
    try {
      const url = `http://127.0.0.1:${await restarted.listen()}`;
      const active = await device(url, newSecret);
      assert.deepEqual(await (await fetch(url + "/api/status", { headers: { cookie } })).json(), { online: true, paired: false });
      active.ws.close();
      await once(active.ws, "close");
    } finally { await restarted.close(); }
  } finally { await rm(join(f.stateFile, ".."), { recursive: true, force: true }); }
});

test("rotation invalidates an outstanding pairing code", async () => {
  const f = await fixture();
  try {
    const d = await device(f.url);
    const codeFrame = next(d.ws);
    d.ws.send(JSON.stringify({ type: "pair.request" }));
    const { code } = await codeFrame;
    const rotated = next(d.ws);
    d.ws.send(JSON.stringify({ type: "device.rotate", secret: randomBytes(32).toString("hex") }));
    assert.equal((await rotated).type, "device.rotated");
    const response = await fetch(f.url + "/api/pair", {
      method: "POST",
      headers: { origin: f.url, "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    assert.equal(response.status, 403);
  } finally { await f.cleanup(); }
});

test("authenticated HTTP RPC and browser event use only safe fields", async () => {
  const f = await fixture();
  try {
    const d = await device(f.url);
    const cookie = await pair(f.url, d.ws);
    const browser = await socket(f.url, "/ws/browser", { cookie, origin: f.url });
    const request = next(d.ws);
    const result = fetch(f.url + "/api/sessions", { headers: { cookie } });
    const frame = await request;
    assert.equal(frame.action, "sessions.list");
    d.ws.send(JSON.stringify({ type: "response", id: frame.id, ok: true, data: [{ sessions: [{ id: "s1", title: "Hello", updatedAt: 1, private: "SECRET" }] }] }));
    assert.deepEqual(await (await result).json(), { sessions: [{ id: "s1", title: "Hello", state: "idle", updatedAt: 1 }] });
    const event = next(browser);
    d.ws.send(JSON.stringify({ type: "event", sessionId: "s1", event: { type: "delta", text: "hello", secret: "SECRET" } }));
    assert.deepEqual(await event, { type: "event", seq: 1, sessionId: "s1", event: { type: "delta", text: "hello" } });
    browser.close();
  } finally { await f.cleanup(); }
});

test("session detail and message send round-trip; offline requests fail closed", async () => {
  const f = await fixture();
  try {
    const d = await device(f.url);
    const cookie = await pair(f.url, d.ws);
    const detailFrame = next(d.ws);
    const detail = fetch(f.url + "/api/sessions/s1", { headers: { cookie } });
    const get = await detailFrame;
    assert.deepEqual({ action: get.action, sessionId: get.sessionId }, { action: "sessions.get", sessionId: "s1" });
    d.ws.send(JSON.stringify({ type: "response", id: get.id, ok: true, data: { session: { id: "s1", title: "Chat", draft: "SECRET" }, messages: [{ id: "m1", role: "assistant", content: "hi", createdAt: 2, secret: "SECRET" }] } }));
    assert.deepEqual(await (await detail).json(), { session: { id: "s1", title: "Chat", state: "idle" }, messages: [{ id: "m1", role: "assistant", content: "hi", createdAt: 2 }] });
    const sentFrame = next(d.ws);
    const sent = fetch(f.url + "/api/sessions/s1/messages", { method: "POST", headers: { cookie, origin: f.url, "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
    const frame = await sentFrame;
    assert.deepEqual({ action: frame.action, sessionId: frame.sessionId, text: frame.text }, { action: "message.send", sessionId: "s1", text: "hello" });
    d.ws.send(JSON.stringify({ type: "response", id: frame.id, ok: true, data: { sessionId: "s1" } }));
    assert.equal((await sent).status, 200);
    const closed = once(d.ws, "close");
    d.ws.close();
    await closed;
    assert.equal((await fetch(f.url + "/api/sessions", { headers: { cookie } })).status, 503);
  } finally { await f.cleanup(); }
});

test("origin, paths and unauthenticated requests are rejected", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url + "/api/sessions")).status, 401);
    assert.equal((await fetch(f.url + "/api/sessions/s1")).status, 401);
    assert.equal((await fetch(f.url + "/api/pair", { method: "POST", headers: { origin: "https://attacker.test" }, body: "{}" })).status, 403);
    assert.equal((await fetch(f.url + "/api/pair", { method: "POST", headers: { origin: f.url, "content-type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await fetch(f.url + "/assets/%2e%2e/%2e%2e/package.json")).status, 404);
    assert.equal((await fetch(f.url + "/index.html")).status, 404);
    assert.equal((await fetch(f.url + "/remote.html")).status, 200);
    await assert.rejects(createRelay({ stateFile: resolve("apps/relay/state.json") }));
    await assert.rejects(socket(f.url, "/ws/browser", { origin: f.url }));
    await assert.rejects(socket(f.url, "/ws/device?secret=x"));
  } finally { await f.cleanup(); }
});
