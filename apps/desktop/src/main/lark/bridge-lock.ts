import { mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * 飞书桥接跨进程单实例锁：lark-cli event bus 会把事件广播给所有 consumer，
 * 多个 Zen 实例同时启用飞书桥接会重复处理同一消息，用文件锁保证只有一个实例
 * 拉起 consumer。锁文件 ~/.zen/lark-bridge.lock（与 zen-dir 的 zenRoot 同路径；
 * 此处不引 zen-dir，避免测试链路拉起 electron）。
 *
 * 跨平台（macOS/Windows/Linux）：
 * - 抢锁用 writeFileSync 的 wx 模式（O_EXCL 语义三平台一致）；
 * - 陈旧锁判定：持有 PID 不存在（process.kill(pid, 0) 抛 ESRCH）或 mtime 超过
 *   60s 未心跳 → 抢占；Windows 下删除/覆盖可能因文件占用失败，失败即视为占用。
 */

export interface LarkBridgeLockResult {
  ok: boolean;
  /** 抢锁失败时的持有者 PID（锁内容损坏/读不到时为 undefined） */
  holderPid?: number;
}

const HEARTBEAT_MS = 15_000;
const STALE_MS = 60_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function lockFilePath(lockPath?: string): string {
  return lockPath ?? join(homedir(), ".zen", "lark-bridge.lock");
}

function readHolder(path: string): { pid: number; startedAt: number } | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.pid !== "number" || !Number.isFinite(obj.pid)) {
      return null;
    }
    return { pid: obj.pid, startedAt: typeof obj.startedAt === "number" ? obj.startedAt : 0 };
  } catch {
    return null;
  }
}

/** pid 存活探测：ESRCH=不存在；EPERM=存在但无权限（视为存活）；三平台语义一致 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 陈旧判定：持有 PID 已退出，或 mtime 超过 STALE_MS 未心跳 */
function isStale(path: string, holder: { pid: number } | null): boolean {
  if (holder && !isPidAlive(holder.pid)) {
    return true;
  }
  try {
    return Date.now() - statSync(path).mtimeMs > STALE_MS;
  } catch {
    // 锁文件刚被并发清理：按陈旧处理，允许重试抢锁
    return true;
  }
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(path: string): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    refreshLarkBridgeLock(path);
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

/**
 * 抢锁；失败返回持有者 PID。重复调用幂等（自己已持有时只续期）。
 * 成功后启动心跳定时器（约 15s touch mtime），releaseLarkBridgeLock 停止。
 */
export function acquireLarkBridgeLock(lockPath?: string): LarkBridgeLockResult {
  const path = lockFilePath(lockPath);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // 目录已存在 / 并发创建失败：继续走抢锁
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), {
        flag: "wx",
      });
      startHeartbeat(path);
      return { ok: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // Windows 下目录权限 / 磁盘占用等：视为抢锁失败，但不吞掉非冲突错误以外的语义
        return { ok: false, holderPid: readHolder(path)?.pid };
      }
    }
    const holder = readHolder(path);
    if (holder?.pid === process.pid) {
      // 自己已持有（start 重试）：续期即可
      refreshLarkBridgeLock(path);
      startHeartbeat(path);
      return { ok: true };
    }
    if (!isStale(path, holder)) {
      return { ok: false, holderPid: holder?.pid };
    }
    try {
      unlinkSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }
      // Windows 文件被占用删不掉：视为仍被占用
      return { ok: false, holderPid: holder?.pid };
    }
  }
  return { ok: false, holderPid: readHolder(path)?.pid };
}

/** 心跳：touch mtime 表明存活；锁已易主/丢失时返回 false 且不替他人保活 */
export function refreshLarkBridgeLock(lockPath?: string): boolean {
  const path = lockFilePath(lockPath);
  const holder = readHolder(path);
  if (!holder || holder.pid !== process.pid) {
    return false;
  }
  try {
    const now = new Date();
    utimesSync(path, now, now);
    return true;
  } catch {
    return false;
  }
}

/** 释放锁：只删自己持有的锁文件；Windows 删除失败容错忽略 */
export function releaseLarkBridgeLock(lockPath?: string): void {
  const path = lockFilePath(lockPath);
  stopHeartbeat();
  const holder = readHolder(path);
  if (holder && holder.pid !== process.pid) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    // 已删除 / Windows 文件占用：忽略
  }
}
