import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { LarkAuthSnapshot } from "@zen/shared";

import { resolveLarkCliPath } from "./cli";

const execFileAsync = promisify(execFile);

/** 登录态短缓存：避免每次状态查询/网关启停都拉起两次子进程 */
const CACHE_TTL_MS = 30_000;
/** auth status 最长等待（登录态探测不应长时间阻塞网关启动） */
const AUTH_TIMEOUT_MS = 10_000;
/** --version 最长等待 */
const VERSION_TIMEOUT_MS = 5_000;

let cache: { snapshot: LarkAuthSnapshot; at: number } | null = null;
let inflight: Promise<LarkAuthSnapshot> | null = null;

function unavailableSnapshot(error: string): LarkAuthSnapshot {
  return {
    available: false,
    version: null,
    appId: null,
    brand: null,
    botReady: false,
    userOpenId: null,
    userName: null,
    error,
  };
}

/** `auth status --json` 原始输出的宽松类型（字段缺失/类型漂移都要兜住） */
interface LarkAuthStatusRaw {
  appId?: unknown;
  brand?: unknown;
  identities?: {
    bot?: { status?: unknown; available?: unknown };
    user?: { status?: unknown; available?: unknown; openId?: unknown; userName?: unknown };
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function probeCliVersion(cliPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ["--version"], {
      timeout: VERSION_TIMEOUT_MS,
    });
    const line = `${stdout}\n${stderr}`
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean);
    return line ?? null;
  } catch {
    return null;
  }
}

async function probeAuthSnapshot(): Promise<LarkAuthSnapshot> {
  const cliPath = resolveLarkCliPath();
  if (!cliPath) {
    return unavailableSnapshot("未找到 lark-cli 可执行文件，请先 npm install -g @larksuite/cli");
  }
  let raw: LarkAuthStatusRaw;
  try {
    const { stdout } = await execFileAsync(cliPath, ["auth", "status", "--json"], {
      timeout: AUTH_TIMEOUT_MS,
    });
    raw = JSON.parse(stdout) as LarkAuthStatusRaw;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return unavailableSnapshot(`lark-cli auth status 失败：${reason}`);
  }
  const bot = raw.identities?.bot;
  const user = raw.identities?.user;
  const version = await probeCliVersion(cliPath);
  return {
    available: true,
    version,
    appId: asString(raw.appId),
    brand: asString(raw.brand),
    // 发消息走 bot 身份：available 为显式布尔才可信
    botReady: bot?.available === true,
    userOpenId: asString(user?.openId),
    userName: asString(user?.userName),
    error: null,
  };
}

/** 探测 lark-cli 登录态（带 30s 短缓存与并发去重；任何失败都返回 available:false + 原因） */
export async function readLarkAuthSnapshot(): Promise<LarkAuthSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.snapshot;
  }
  if (!inflight) {
    inflight = probeAuthSnapshot()
      .then((snapshot) => {
        cache = { snapshot, at: Date.now() };
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 丢弃最近一次探测缓存（登录/登出后强制重新探测） */
export function invalidateLarkAuthCache(): void {
  cache = null;
}

/** 同步取最近一次探测结果（广播 lark:changed 用，不触发子进程；未探测过返回 unavailable） */
export function peekLarkAuthSnapshot(): LarkAuthSnapshot {
  return cache?.snapshot ?? unavailableSnapshot("尚未探测 lark-cli 登录态");
}
