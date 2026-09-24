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
/** contact +get-user（self）最长等待：头像缺失可接受，不能拖慢探测 */
const PROFILE_TIMEOUT_MS = 8_000;
/** 用户资料缓存：头像/姓名变化低频，同一 open_id 短期复用，避免每次探测都拉子进程 */
const PROFILE_CACHE_TTL_MS = 10 * 60_000;

let cache: { snapshot: LarkAuthSnapshot; at: number } | null = null;
let inflight: Promise<LarkAuthSnapshot> | null = null;
/** 用户资料（姓名/头像）短缓存：低频变化，按 open_id 复用 */
let profileCache: { openId: string; name: string | null; avatarUrl: string | null; at: number } | null = null;

function unavailableSnapshot(error: string, cliInstalled = false): LarkAuthSnapshot {
  return {
    cliInstalled,
    available: false,
    version: null,
    appId: null,
    brand: null,
    botReady: false,
    userOpenId: null,
    userName: null,
    userAvatarUrl: null,
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

/** `contact +get-user`（省略 user_id 即自己）输出的宽松类型 */
interface LarkUserProfileRaw {
  data?: { user?: { name?: unknown; avatar_url?: unknown } };
}

/** 探测当前登录用户的姓名与头像（失败静默降级为 null，不影响登录态判定） */
async function probeUserProfile(cliPath: string, openId: string): Promise<{ name: string | null; avatarUrl: string | null }> {
  if (profileCache && profileCache.openId === openId && Date.now() - profileCache.at < PROFILE_CACHE_TTL_MS) {
    return { name: profileCache.name, avatarUrl: profileCache.avatarUrl };
  }
  try {
    const { stdout } = await execFileAsync(cliPath, ["contact", "+get-user", "--json"], {
      timeout: PROFILE_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as LarkUserProfileRaw;
    const profile = {
      name: asString(parsed.data?.user?.name),
      avatarUrl: asString(parsed.data?.user?.avatar_url),
    };
    profileCache = { openId, ...profile, at: Date.now() };
    return profile;
  } catch {
    // 探测失败不缓存（下次探测重试），也不阻塞登录态
    return { name: null, avatarUrl: null };
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
    return unavailableSnapshot(`lark-cli auth status 失败：${reason}`, true);
  }
  const bot = raw.identities?.bot;
  const user = raw.identities?.user;
  const userOpenId = asString(user?.openId);
  const version = await probeCliVersion(cliPath);
  // 已登录时补探姓名/头像（profile 失败不影响 available）
  const profile = userOpenId ? await probeUserProfile(cliPath, userOpenId) : { name: null, avatarUrl: null };
  return {
    cliInstalled: true,
    available: true,
    version,
    appId: asString(raw.appId),
    brand: asString(raw.brand),
    // 发消息走 bot 身份：available 为显式布尔才可信
    botReady: bot?.available === true,
    userOpenId,
    userName: profile.name ?? asString(user?.userName),
    userAvatarUrl: profile.avatarUrl,
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
