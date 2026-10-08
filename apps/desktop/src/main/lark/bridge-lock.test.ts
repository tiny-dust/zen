import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  acquireLarkBridgeLock,
  refreshLarkBridgeLock,
  releaseLarkBridgeLock,
} from "./bridge-lock";

/** 独立临时目录，不打真实 ~/.zen */
const dir = mkdtempSync(join(tmpdir(), "zen-lark-lock-"));
const lockPath = join(dir, "lark-bridge.lock");

function writeLockFile(pid: number): void {
  writeFileSync(lockPath, JSON.stringify({ pid, startedAt: Date.now() }));
}

function deadPid(): number {
  // 一个已退出子进程的 pid：spawnSync 返回后必然不存在
  return spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" }).pid ?? 999_999;
}

afterAll(() => {
  releaseLarkBridgeLock(lockPath);
  rmSync(dir, { recursive: true, force: true });
});

describe("飞书桥接跨进程文件锁", () => {
  it("抢锁：新锁写入本进程 pid，重复抢锁幂等", () => {
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    expect(holder.pid).toBe(process.pid);
    // 自己已持有：重复抢锁续期而非报占用
    expect(acquireLarkBridgeLock(lockPath).ok).toBe(true);
    releaseLarkBridgeLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("重复抢锁：他进程持有（PID 存活 + 新鲜 mtime）→ 失败并返回 holderPid", () => {
    writeLockFile(process.ppid);
    expect(existsSync(lockPath)).toBe(true);
    const result = acquireLarkBridgeLock(lockPath);
    expect(result.ok).toBe(false);
    expect(result.holderPid).toBe(process.ppid);
    // 不动他人的锁
    expect(existsSync(lockPath)).toBe(true);
  });

  it("陈旧锁抢占：持有 PID 已不存在 → 抢锁成功并覆盖内容", () => {
    writeLockFile(deadPid());
    const result = acquireLarkBridgeLock(lockPath);
    expect(result).toEqual({ ok: true });
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    expect(holder.pid).toBe(process.pid);
    releaseLarkBridgeLock(lockPath);
  });

  it("陈旧锁抢占：持有 PID 存活但 mtime 超过 60s 未心跳 → 抢锁成功", () => {
    writeLockFile(process.ppid);
    const old = new Date(Date.now() - 2 * 60_000);
    utimesSync(lockPath, old, old);
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    releaseLarkBridgeLock(lockPath);
  });

  it("refresh：自己持有时 touch mtime；他进程持有/锁丢失 → false 且不替他人保活", () => {
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    const old = new Date(Date.now() - 2 * 60_000);
    utimesSync(lockPath, old, old);
    expect(refreshLarkBridgeLock(lockPath)).toBe(true);
    expect(refreshLarkBridgeLock(join(dir, "missing.lock"))).toBe(false);

    writeLockFile(process.ppid);
    const foreignMtime = new Date(Date.now() - 2 * 60_000);
    utimesSync(lockPath, foreignMtime, foreignMtime);
    expect(refreshLarkBridgeLock(lockPath)).toBe(false);
  });

  it("release：只删自己的锁；他进程持有的锁不删", () => {
    writeLockFile(process.ppid);
    releaseLarkBridgeLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);

    writeLockFile(deadPid());
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    releaseLarkBridgeLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });
});
