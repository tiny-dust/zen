#!/usr/bin/env node
/**
 * Keep-alive wrapper for impeccable live-poll.mjs
 * One event → append to events.ndjson → reply not needed here → poll again
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/reynold/Self/zen";
const POLL = "/Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs";
const LOG_DIR = path.join(ROOT, ".impeccable/live/agent");
const EVENTS = path.join(LOG_DIR, "events.ndjson");
const STATUS = path.join(LOG_DIR, "status.json");

fs.mkdirSync(LOG_DIR, { recursive: true });

function writeStatus(state, detail = "") {
  fs.writeFileSync(
    STATUS,
    JSON.stringify({ state, detail, pid: process.pid, at: new Date().toISOString() }, null, 2),
  );
}

function runPollOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [POLL], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

async function main() {
  writeStatus("polling", "waiting for browser events");
  for (;;) {
    try {
      const { code, out, err } = await runPollOnce();
      if (out) {
        const line = out.split("\n").filter(Boolean).pop() || out;
        try {
          const event = JSON.parse(line);
          fs.appendFileSync(EVENTS, line + "\n");
          writeStatus("event", `${event.type || "?"} ${event.id || ""}`);
        } catch {
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
    await new Promise((r) => setTimeout(r, 400));
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
