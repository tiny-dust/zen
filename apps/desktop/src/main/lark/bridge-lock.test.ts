import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  /** 非空时 unlinkSync 走该实现（模拟 Windows 文件占用/竞态消失） */
  unlinkImpl: null as null | ((path: string) => never),
  /** 非空时 utimesSync 走该实现（模拟心跳 touch 失败） */
  utimesImpl: null as null | ((path: string) => never),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    unlinkSync: ((path: Parameters<typeof actual.unlinkSync>[0]) => {
      if (fsState.unlinkImpl) {
        fsState.unlinkImpl(String(path));
      }
      return actual.unlinkSync(path);
    }) as typeof actual.unlinkSync,
    utimesSync: ((...args: Parameters<typeof actual.utimesSync>) => {
      if (fsState.utimesImpl) {
        fsState.utimesImpl(String(args[0]));
      }
      return actual.utimesSync(...args);
    }) as typeof actual.utimesSync,
  };
});

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


afterEach(() => {
  fsState.unlinkImpl = null;
  fsState.utimesImpl = null;
  vi.restoreAllMocks();
});

describe("飞书桥接文件锁：边界分支", () => {
  it("锁内容损坏（非 JSON / pid 非数字 / 非对象）→ holderPid 为 undefined", () => {
    for (const content of ["not-json", '{"pid":"x"}', "[]", "null", "123"]) {
      writeFileSync(lockPath, content);
      const result = acquireLarkBridgeLock(lockPath);
      expect(result.ok).toBe(false);
      expect(result.holderPid).toBeUndefined();
    }
  });

  it("isPidAlive 的 EPERM 视为存活：特权 PID 持锁时不抢占", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("EPERM") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    writeLockFile(1);
    const result = acquireLarkBridgeLock(lockPath);
    expect(result.ok).toBe(false);
    expect(result.holderPid).toBe(1);
    killSpy.mockRestore();
  });

  it("抢锁写入遇到非 EEXIST 错误（父路径是文件）→ 失败但不抛错", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "i am a file");
    const badPath = join(blocker, "sub", "lock");
    const result = acquireLarkBridgeLock(badPath);
    expect(result.ok).toBe(false);
    expect(result.holderPid).toBeUndefined();
  });

  it("陈旧锁 unlink 遇 ENOENT（竞态消失）→ 重试一次后放弃并返回 holderPid", () => {
    writeLockFile(deadPid());
    fsState.unlinkImpl = () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };
    const result = acquireLarkBridgeLock(lockPath);
    expect(result.ok).toBe(false);
    // 锁内容仍是死 PID
    expect(result.holderPid).toBeGreaterThan(0);
  });

  it("陈旧锁 unlink 遇非 ENOENT 错误（Windows 文件占用）→ 视为仍被占用", () => {
    writeLockFile(deadPid());
    fsState.unlinkImpl = () => {
      const error = new Error("EPERM") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    };
    const result = acquireLarkBridgeLock(lockPath);
    expect(result.ok).toBe(false);
    expect(result.holderPid).toBeGreaterThan(0);
  });

  it("release：自己持锁但删除失败 → 容错忽略不抛", () => {
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    fsState.unlinkImpl = () => {
      const error = new Error("EPERM") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    };
    expect(() => releaseLarkBridgeLock(lockPath)).not.toThrow();
    fsState.unlinkImpl = null;
    releaseLarkBridgeLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refresh：utimes 失败（心跳 touch 不动）→ 返回 false", () => {
    expect(acquireLarkBridgeLock(lockPath)).toEqual({ ok: true });
    fsState.utimesImpl = () => {
      throw new Error("EIO");
    };
    expect(refreshLarkBridgeLock(lockPath)).toBe(false);
    fsState.utimesImpl = null;
    releaseLarkBridgeLock(lockPath);
  });
});
