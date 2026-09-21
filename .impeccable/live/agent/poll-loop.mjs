#!/usr/bin/env node
/**
 * Keep-alive for impeccable live-poll.mjs
 * steer events: auto-ack immediately so the page chat unlocks
 * all events: append to events.ndjson for the coding agent
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/reynold/Self/zen";
const POLL = "/Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs";
const LOG_DIR = path.join(ROOT, ".impeccable/live/agent");
const EVENTS = path.join(LOG_DIR, "events.ndjson");
const STATUS = path.join(LOG_DIR, "status.json");
const REPLIED = path.join(LOG_DIR, "replied.ids");
const PENDING = path.join(LOG_DIR, "pending-agent.ndjson");

fs.mkdirSync(LOG_DIR, { recursive: true });

function writeStatus(state, detail = "") {
  fs.writeFileSync(
    STATUS,
    JSON.stringify({ state, detail, pid: process.pid, at: new Date().toISOString() }, null, 2),
  );
}

function loadReplied() {
  try {
    return new Set(fs.readFileSync(REPLIED, "utf8").split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function markReplied(id) {
  const set = loadReplied();
  if (set.has(id)) return;
  fs.appendFileSync(REPLIED, id + "\n");
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

function runPollOnce() {
  return run(process.execPath, [POLL]);
}

async function replySteer(event) {
  const id = event.id;
  if (!id || loadReplied().has(id)) return;
  const msg = String(event.message || "").slice(0, 200);
  const ack = `已收到：「${msg}」。连接正常；代码层改动见 MiMo 会话。用「选取」点中元素可精确改 UI。`;
  const result = await run(process.execPath, [POLL, "--reply", id, "steer_done", ack]);
  if (result.err && !/already|unknown|not found/i.test(result.err)) {
    writeStatus("reply_error", `${id}: ${result.err.slice(0, 160)}`);
  }
  markReplied(id);
}

async function main() {
  writeStatus("polling", "waiting for browser events");
  for (;;) {
    try {
      const { code, out, err } = await runPollOnce();
      if (out) {
        const line = out.split("\n").filter(Boolean).pop() || out;
        let event = null;
        try {
          event = JSON.parse(line);
        } catch {
          /* raw */
        }
        if (event && event.id && !loadReplied().has(event.id)) {
          fs.appendFileSync(EVENTS, line + "\n");
          fs.appendFileSync(PENDING, line + "\n");
          writeStatus("event", `${event.type || "?"} ${event.id}`);
          if (event.type === "steer") {
            await replySteer(event);
          }
          // generate/accept/discard/exit: leave for coding agent
        } else if (event && event.id && loadReplied().has(event.id)) {
          // already handled
        } else {
          fs.appendFileSync(EVENTS, line + "\n");
          writeStatus("raw", line.slice(0, 200));
        }
      } else if (err) {
        writeStatus("error", err.slice(0, 200));
      } else {
        writeStatus("idle", `poll exit ${code}`);
      }
    } catch (error) {
      writeStatus("error", error instanceof Error ? error.message : String(error));
    }
    await new Promise((r) => setTimeout(r, 300));
    writeStatus("polling", "waiting for browser events");
  }
}

process.on("SIGTERM", () => {
  writeStatus("stopped", "SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  writeStatus("stopped", "SIGINT");
  process.exit(0);
});

main().catch((error) => {
  writeStatus("fatal", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
