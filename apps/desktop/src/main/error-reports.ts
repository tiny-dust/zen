import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app, ipcMain } from "electron";

import type {
  ErrorReportAnalysis,
  ErrorReportKind,
  ErrorReportPayload,
  ErrorReportRecord,
  ErrorReportSource,
} from "@zen/shared";

import { zenRoot } from "./zen-dir";

/**
 * 运行时异常收集（主进程侧）：uncaught/unhandled/渲染层上报统一落
 * ~/.zen/error-reports.json，按 kind+消息+应用帧去重累计次数，超上限
 * 按 lastSeenAt 淘汰最旧；本地启发式判定是否软件（Zen 自身代码）相关。
 */

const MESSAGE_LIMIT = 500;
const STACK_LIMIT = 4000;
const MAX_REPORTS = 200;

const ERROR_REPORT_KINDS: readonly ErrorReportKind[] = [
  "uncaught",
  "unhandled",
  "window-error",
  "vue",
  "resource-error",
  "render-process-gone",
];

/** 应用代码帧特征：asar/打包资源、monorepo 源码目录、@zen/* 工作区包、zen/dist 产物；
 * dev 渲染层堆栈是 http://localhost:<port>/src/... 源码 URL，/src/ 路径与 .vue 模块同样视为应用帧 */
const APP_FRAME_PATTERN =
  /(app\.asar|resources[\\/]app|apps[\\/](?:desktop|ui)|packages[\\/]agent-core|@zen[\\/][\w.-]+|zen[\\/]dist|localhost:\d+\/src\/|\/src\/[\w./-]+\.(?:vue|ts)|[\w-]+\.vue(?:\?|$))/;

/** 网络类环境错误：连接拒绝/超时、域名解析失败、DNS */
const NETWORK_ERROR_PATTERN = /(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|getaddrinfo|DNS)/i;

/** 典型代码缺陷消息：调不存在的方法/读 undefined 属性等 */
const CODE_ERROR_PATTERN = /(is not a function|Cannot read propert|Cannot set propert|is not a constructor|is not defined)/;

/** Electron 生命周期噪声：正常退出、已销毁对象、GPU 进程 */
const NOISE_PATTERN = /(clean-exit|Object has been destroyed|GPU)/;

export function errorReportsFile(): string {
  return join(zenRoot(), "error-reports.json");
}

async function loadErrorReports(filePath: string): Promise<ErrorReportRecord[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is ErrorReportRecord =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ErrorReportRecord).id === "string",
    );
  } catch {
    // 读失败/文件不存在/JSON 损坏：回退空列表，下次写入会重建
    return [];
  }
}

/** 临时文件 + rename 原子写：读到一半/写一半不会出现半截 JSON */
async function saveErrorReports(filePath: string, records: ErrorReportRecord[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2), "utf8");
  await rename(tmp, filePath);
}

/** stack 中首个含应用代码特征的帧（去重用；无则空串） */
function firstAppFrame(stack: string): string {
  for (const line of stack.split("\n")) {
    if (APP_FRAME_PATTERN.test(line)) {
      return line.trim();
    }
  }
  return "";
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * 记录一条异常：命中去重 key 则 count+1、lastSeenAt 更新，否则新建记录。
 * 返回变更后的记录与是否为去重累计；filePath 供测试注入临时存储路径。
 */
export async function recordErrorReport(
  source: ErrorReportSource,
  kind: ErrorReportKind,
  message: string,
  stack?: string,
  filePath?: string,
): Promise<{ record: ErrorReportRecord; deduplicated: boolean }> {
  const file = filePath ?? errorReportsFile();
  const records = await loadErrorReports(file);
  const trimmedMessage = truncate(message, MESSAGE_LIMIT);
  const trimmedStack = stack ? truncate(stack, STACK_LIMIT) : undefined;
  const appFrame = firstAppFrame(trimmedStack ?? "");
  const now = Date.now();

  // 去重 key = kind + 截断消息 + 应用帧（无则空串）：同源同错累计次数
  const existing = records.find(
    (item) =>
      item.kind === kind &&
      item.message === trimmedMessage &&
      firstAppFrame(item.stack ?? "") === appFrame,
  );
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = now;
    await saveErrorReports(file, records);
    return { record: existing, deduplicated: true };
  }

  const record: ErrorReportRecord = {
    id: randomUUID(),
    source,
    kind,
    message: trimmedMessage,
    stack: trimmedStack,
    firstSeenAt: now,
    lastSeenAt: now,
    count: 1,
    appVersion: app.getVersion(),
    platform: process.platform,
  };
  records.push(record);
  // 超上限淘汰 lastSeenAt 最旧的记录
  if (records.length > MAX_REPORTS) {
    records.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    records.splice(0, records.length - MAX_REPORTS);
  }
  await saveErrorReports(file, records);
  return { record, deduplicated: false };
}

/** 列出全部异常，最新 lastSeenAt 在前 */
export async function listErrorReports(filePath?: string): Promise<ErrorReportRecord[]> {
  const records = await loadErrorReports(filePath ?? errorReportsFile());
  return records.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** 清空全部（无 ids）或删除指定 id 集合；返回删除条数 */
export async function clearErrorReports(
  ids?: string[],
  filePath?: string,
): Promise<{ removed: number }> {
  const file = filePath ?? errorReportsFile();
  const records = await loadErrorReports(file);
  if (!ids) {
    await saveErrorReports(file, []);
    return { removed: records.length };
  }
  const remove = new Set(ids);
  const kept = records.filter((item) => !remove.has(item.id));
  await saveErrorReports(file, kept);
  return { removed: records.length - kept.length };
}

/**
 * 本地启发式分析：是否与软件（Zen 自身代码）相关。
 * 优先级：生命周期噪声 → 外部环境/网络 → 应用代码特征 → 信息不足。
 */
export function analyzeErrorReport(record: ErrorReportRecord): ErrorReportAnalysis {
  const text = `${record.message}\n${record.stack ?? ""}`;

  if (NOISE_PATTERN.test(record.message)) {
    return {
      softwareRelated: false,
      confidence: "low",
      reason: "多为 Electron 运行时噪声（进程正常退出/对象已销毁/GPU 进程），一般不是软件缺陷",
    };
  }

  if (NETWORK_ERROR_PATTERN.test(text)) {
    return {
      softwareRelated: false,
      confidence: "high",
      reason: "外部网络环境问题：连接被拒绝/超时或域名解析失败，请检查目标服务与网络连通性",
    };
  }

  if (/spawn .*ENOENT/.test(record.message)) {
    return {
      softwareRelated: false,
      confidence: "high",
      reason: "外部环境问题：要启动的命令不存在（command not found），请检查依赖安装与 PATH 配置",
    };
  }

  if (/ENOENT/.test(text)) {
    return {
      softwareRelated: false,
      confidence: "high",
      reason: "外部环境问题：用户文件或目录不存在（ENOENT），请检查被访问路径",
    };
  }

  if (/(EACCES|EPERM)/.test(text)) {
    return {
      softwareRelated: false,
      confidence: "high",
      reason: "外部环境问题：文件/目录权限不足（EACCES/EPERM），请检查用户目录读写权限",
    };
  }

  if (/ENOSPC|no space/i.test(text)) {
    return {
      softwareRelated: false,
      confidence: "high",
      reason: "外部环境问题：磁盘空间不足，请清理磁盘后重试",
    };
  }

  const appFrame = firstAppFrame(record.stack ?? "");
  if (appFrame || CODE_ERROR_PATTERN.test(record.message)) {
    return {
      softwareRelated: true,
      confidence: "high",
      reason: appFrame
        ? `堆栈命中 Zen 应用代码帧（${appFrame.slice(0, 160)}），大概率是软件自身缺陷`
        : "错误消息为典型代码缺陷（调用不存在的方法/读写空属性等），大概率是软件自身缺陷",
    };
  }

  return {
    softwareRelated: false,
    confidence: "low",
    reason: "信息不足，无法判定是否与软件相关",
  };
}

function isReportKind(value: unknown): value is ErrorReportKind {
  return typeof value === "string" && (ERROR_REPORT_KINDS as readonly string[]).includes(value);
}

/** IPC 边界校验：只接受合法 kind + 非空 message 的上报载荷 */
function asReportPayload(value: unknown): ErrorReportPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { kind, message, stack } = value as Partial<ErrorReportPayload>;
  if (!isReportKind(kind) || typeof message !== "string" || !message.trim()) {
    return null;
  }
  if (stack !== undefined && typeof stack !== "string") {
    return null;
  }
  return { kind, message, stack };
}

/**
 * 异常中心 IPC：errors:list / errors:clear / errors:analyze 供异常中心面板，
 * errors:report 接收渲染层上报（source 固定 renderer）。
 * 记录成功后 broadcast("errors:changed", null) 通知各窗口刷新；
 * broadcast 由调用方传入（窗口可能尚不存在，需安全空转）。
 */
export function registerErrorReportsIpc(
  broadcast: (channel: string, payload: unknown) => void,
): void {
  ipcMain.handle("errors:list", async (): Promise<ErrorReportRecord[]> => listErrorReports());

  ipcMain.handle("errors:clear", async (_event, ids?: unknown): Promise<{ ok: boolean; removed?: number; error?: string }> => {
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))) {
      return { ok: false, error: "invalid ids" };
    }
    const { removed } = await clearErrorReports(ids as string[] | undefined);
    broadcast("errors:changed", null);
    return { ok: true, removed };
  });

  ipcMain.handle("errors:analyze", async (_event, id?: unknown): Promise<ErrorReportAnalysis | null> => {
    if (typeof id !== "string" || !id) {
      return null;
    }
    const record = (await listErrorReports()).find((item) => item.id === id);
    return record ? analyzeErrorReport(record) : null;
  });

  ipcMain.handle("errors:report", async (_event, payload?: unknown): Promise<{ ok: boolean; error?: string }> => {
    const valid = asReportPayload(payload);
    if (!valid) {
      return { ok: false, error: "invalid error report payload" };
    }
    await recordErrorReport("renderer", valid.kind, valid.message, valid.stack);
    broadcast("errors:changed", null);
    return { ok: true };
  });
}
