import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveWorkspacePath } from "@zen/tools-fs";

import { sessionCacheDir } from "./zen-dir";

import type { FileCheckpoint, TurnCheckpointGroup } from "@zen/shared";

/**
 * 会话文件快照（检查点）：Agent 写/改文件前把工作区原文件备份到
 * ~/.zen/cache/sessions/<sessionId>/checkpoints/，manifest.jsonl 逐行追加记录，
 * 支持列出与恢复（对非 git 工作区是唯一的回退手段）。
 *
 * 每轮 run（一条用户消息驱动的一次执行，含子 Agent/插入执行）开始处打一个
 * turn 标记自增 run 序号；写文件前备份 before 副本、写入成功后备份 after 副本，
 * 同轮记录可整体撤销（恢复 before）或重新套用（恢复 after）。
 */

function checkpointsDir(sessionId: string): string {
  return join(sessionCacheDir(sessionId), "checkpoints");
}

function manifestFile(sessionId: string): string {
  return join(checkpointsDir(sessionId), "manifest.jsonl");
}

/** 备份文件名：`/` 换 `__` 保证平铺在 checkpoints 目录下，before/after 区分改前改后 */
function backupFileName(kind: "before" | "after", relativePath: string, createdAt: number): string {
  return `${createdAt}-${kind}-${relativePath.replace(/\//g, "__")}`;
}

/** manifest 追加型日志里的非文件记录（文件记录即 FileCheckpoint 本体，无 kind 字段） */
interface TurnMarkerRecord {
  kind: "turn";
  run: number;
  createdAt: number;
}

interface AfterCopyRecord {
  kind: "after";
  checkpointId: string;
  afterFile: string;
  createdAt: number;
}

interface TurnStateRecord {
  kind: "turn_state";
  run: number;
  state: "undone" | "reapplied";
  createdAt: number;
}

/** manifest 解析结果：文件记录（已合并 after 副本）+ 轮标记 + 轮状态 */
interface ManifestData {
  files: FileCheckpoint[];
  turnMarkers: Map<number, TurnMarkerRecord>;
  turnStates: Map<number, TurnStateRecord>;
}

function isFileCheckpoint(value: unknown): value is FileCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FileCheckpoint>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.relativePath === "string" &&
    typeof item.createdAt === "number"
  );
}

function isAfterCopyRecord(value: unknown): value is AfterCopyRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<AfterCopyRecord>;
  return (
    item.kind === "after" &&
    typeof item.checkpointId === "string" &&
    typeof item.afterFile === "string"
  );
}

/** 读 manifest 并解析四类记录；坏行跳过不崩（追加型日志个别损坏不影响其余记录） */
async function readManifest(sessionId: string): Promise<ManifestData> {
  const data: ManifestData = { files: [], turnMarkers: new Map(), turnStates: new Map() };
  let raw: string;
  try {
    raw = await readFile(manifestFile(sessionId), "utf8");
  } catch {
    return data;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isFileCheckpoint(parsed)) {
      data.files.push(parsed);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (record["kind"] === "turn" && typeof record["run"] === "number") {
      data.turnMarkers.set(record["run"], record as unknown as TurnMarkerRecord);
    } else if (
      record["kind"] === "turn_state" &&
      typeof record["run"] === "number" &&
      (record["state"] === "undone" || record["state"] === "reapplied")
    ) {
      // 同轮多次 undo/reapply：后写覆盖，保留最新状态
      data.turnStates.set(record["run"], record as unknown as TurnStateRecord);
    } else if (isAfterCopyRecord(parsed)) {
      // after 副本合并到对应文件记录（记录顺序保证 after 追在文件记录之后）
      const found = data.files.find((item) => item.id === parsed.checkpointId);
      if (found && !found.afterFile) {
        found.afterFile = parsed.afterFile;
      }
    }
  }
  return data;
}

async function appendRecord(sessionId: string, record: object): Promise<void> {
  await mkdir(checkpointsDir(sessionId), { recursive: true });
  await appendFile(manifestFile(sessionId), `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * 每轮 run 开始处打 turn 标记并返回自增后的 run 序号（从 1 起）。
 * manifest 缺失/损坏时按无历史处理，从 1 重新计数（旧快照仍可按 id 单文件恢复）。
 */
export async function beginTurnCheckpoint(sessionId: string): Promise<number> {
  const data = await readManifest(sessionId);
  let maxRun = 0;
  for (const run of data.turnMarkers.keys()) {
    maxRun = Math.max(maxRun, run);
  }
  for (const file of data.files) {
    maxRun = Math.max(maxRun, file.run ?? 1);
  }
  const run = maxRun + 1;
  const marker: TurnMarkerRecord = { kind: "turn", run, createdAt: Date.now() };
  await appendRecord(sessionId, marker);
  return run;
}

/**
 * 写/改文件前备份原文件。文件已存在时复制 before 副本；不存在（本轮新建）也记录
 * 一条无 backupFile 的检查点（撤销时按新建文件移除）。路径越界返回 null；
 * 其余错误向上抛，由调用方（checkpointBridge）吞掉以免阻塞写入。
 */
export async function backupWorkspaceFile(
  sessionId: string,
  workspaceRoot: string,
  relativePath: string,
  run: number,
): Promise<FileCheckpoint | null> {
  let fullPath: string;
  try {
    fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  } catch {
    // 越界路径写入工具自身会拒绝，备份层无需处理
    return null;
  }
  const createdAt = Date.now();
  const dir = checkpointsDir(sessionId);
  const checkpoint: FileCheckpoint = {
    id: randomUUID(),
    sessionId,
    relativePath,
    run,
    createdAt,
  };
  await mkdir(dir, { recursive: true });
  try {
    // 直接复制探测存在性：ENOENT 即文件不存在（新建无需 before 副本）
    checkpoint.backupFile = join(dir, backupFileName("before", relativePath, createdAt));
    await copyFile(fullPath, checkpoint.backupFile);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      delete checkpoint.backupFile;
    } else {
      throw error;
    }
  }
  await appendRecord(sessionId, checkpoint);
  return checkpoint;
}

/**
 * 工具写入成功后备份改后内容（after 副本，reapply 用）。
 * checkpointId 为空（改前备份失败、无对应记录）时跳过，保证该写入不进撤销/重套范围。
 */
export async function backupAfterWrite(
  sessionId: string,
  workspaceRoot: string,
  relativePath: string,
  checkpointId: string,
): Promise<void> {
  let fullPath: string;
  try {
    fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  } catch {
    return;
  }
  const createdAt = Date.now();
  const afterFile = join(
    checkpointsDir(sessionId),
    backupFileName("after", relativePath, createdAt),
  );
  try {
    await copyFile(fullPath, afterFile);
  } catch {
    // 写入后文件已不在（被并发改动/删除）：放弃 after 副本，不影响其余记录
    return;
  }
  await appendRecord(sessionId, {
    kind: "after",
    checkpointId,
    afterFile,
    createdAt,
  } satisfies AfterCopyRecord);
}

/** 列出会话全部文件快照，最新在前 */
export async function listFileCheckpoints(sessionId: string): Promise<FileCheckpoint[]> {
  const data = await readManifest(sessionId);
  return data.files.reverse();
}

/** 按轮分组列出改动摘要，最新一轮在前；无文件改动的轮不返回 */
export async function listTurnCheckpoints(sessionId: string): Promise<TurnCheckpointGroup[]> {
  const data = await readManifest(sessionId);
  const runs = new Map<number, { createdAt: number; paths: Set<string> }>();
  for (const file of data.files) {
    const run = file.run ?? 1;
    let group = runs.get(run);
    if (!group) {
      const marker = data.turnMarkers.get(run);
      group = { createdAt: marker?.createdAt ?? file.createdAt, paths: new Set() };
      runs.set(run, group);
    }
    group.paths.add(file.relativePath);
    // createdAt 用该轮最早的记录时刻（marker 缺失时回退最早文件记录）
    group.createdAt = Math.min(group.createdAt, file.createdAt);
  }
  return [...runs.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([run, group]) => ({
      run,
      createdAt: group.createdAt,
      fileCount: group.paths.size,
      undone: data.turnStates.get(run)?.state === "undone",
    }));
}

/** 把备份复制回工作区原路径（必要时补目录）；找不到 id 或复制失败返回 { ok:false } */
export async function restoreFileCheckpoint(
  sessionId: string,
  workspaceRoot: string,
  checkpointId: string,
): Promise<{ ok: boolean; error?: string }> {
  const items = await listFileCheckpoints(sessionId);
  const found = items.find((item) => item.id === checkpointId);
  if (!found) {
    return { ok: false, error: "checkpoint not found" };
  }
  if (!found.backupFile) {
    return { ok: false, error: "该快照没有改前备份（新建文件的检查点）" };
  }
  try {
    const fullPath = resolveWorkspacePath(workspaceRoot, found.relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await copyFile(found.backupFile, fullPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 撤销/重套结果：applied = 成功处理文件数，skipped = 副本缺失被跳过的文件数 */
interface TurnApplyResult {
  ok: boolean;
  error?: string;
  applied?: number;
  skipped?: number;
}

/** 撤销/重套共用的轮次前置校验：轮存在、状态匹配、更新的轮都处于已撤销态 */
function guardTurnAction(
  data: ManifestData,
  run: number,
  action: "undo" | "reapply",
): { ok: true; files: FileCheckpoint[] } | { ok: false; error: string } {
  const files = data.files.filter((item) => (item.run ?? 1) === run);
  if (!files.length) {
    return { ok: false, error: "没有找到该轮的文件改动" };
  }
  const state = data.turnStates.get(run)?.state;
  if (action === "undo" && state === "undone") {
    return { ok: false, error: "该轮改动已撤销" };
  }
  if (action === "reapply" && state !== "undone") {
    return { ok: false, error: "该轮改动未被撤销，无需重新套用" };
  }
  // 只允许从最新一轮往回逐轮撤销：更新的轮未撤销时直接拒绝，避免用旧副本覆盖新改动
  const newestRun = maxRunWithFiles(data);
  if (run !== newestRun) {
    for (let other = run + 1; other <= newestRun; other += 1) {
      if (data.turnStates.get(other)?.state !== "undone") {
        return { ok: false, error: "请先撤销更新的轮次改动" };
      }
    }
  }
  return { ok: true, files };
}

function maxRunWithFiles(data: ManifestData): number {
  let max = 0;
  for (const file of data.files) {
    max = Math.max(max, file.run ?? 1);
  }
  return max;
}

/**
 * 撤销一轮：该轮每个文件恢复到本轮最早的改前副本；本轮新建的文件（无 before 副本）
 * 从工作区移除（内容仍在 after 副本里，可重新套用找回）。副本缺失的文件跳过不中断。
 */
export async function undoTurnCheckpoints(
  sessionId: string,
  workspaceRoot: string,
  run: number,
): Promise<TurnApplyResult> {
  const data = await readManifest(sessionId);
  const guard = guardTurnAction(data, run, "undo");
  if (!guard.ok) {
    return guard;
  }
  const files = guard.files;
  // 同一路径多次写：撤销用最早一次的 before 副本
  const earliest = new Map<string, FileCheckpoint>();
  for (const file of files) {
    const current = earliest.get(file.relativePath);
    if (!current || file.createdAt < current.createdAt) {
      earliest.set(file.relativePath, file);
    }
  }
  let applied = 0;
  let skipped = 0;
  for (const [relativePath, file] of earliest) {
    try {
      const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
      if (file.backupFile) {
        await mkdir(dirname(fullPath), { recursive: true });
        await copyFile(file.backupFile, fullPath);
      } else {
        // 本轮新建的文件：撤销 = 移除（force 兼容已被手动删除的情况）
        await rm(fullPath, { force: true });
      }
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  if (applied === 0) {
    return { ok: false, error: "副本缺失或恢复失败，本轮改动未撤销" };
  }
  await appendRecord(sessionId, {
    kind: "turn_state",
    run,
    state: "undone",
    createdAt: Date.now(),
  } satisfies TurnStateRecord);
  return { ok: true, applied, skipped };
}

/**
 * 重新套用已撤销的一轮：该轮每个文件恢复到本轮最后一次的改后副本。
 * 无改后副本的文件（如写入后被撤销前又改动过、副本缺失）跳过不中断。
 */
export async function reapplyTurnCheckpoints(
  sessionId: string,
  workspaceRoot: string,
  run: number,
): Promise<TurnApplyResult> {
  const data = await readManifest(sessionId);
  const guard = guardTurnAction(data, run, "reapply");
  if (!guard.ok) {
    return guard;
  }
  const files = guard.files;
  // 同一路径多次写：重套用最后一次的 after 副本
  const latest = new Map<string, FileCheckpoint>();
  for (const file of files) {
    const current = latest.get(file.relativePath);
    if (!current || file.createdAt >= current.createdAt) {
      latest.set(file.relativePath, file);
    }
  }
  let applied = 0;
  let skipped = 0;
  for (const [relativePath, file] of latest) {
    try {
      if (!file.afterFile) {
        skipped += 1;
        continue;
      }
      const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await copyFile(file.afterFile, fullPath);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  if (applied === 0) {
    return { ok: false, error: "没有可用的改后副本，本轮改动未重新套用" };
  }
  await appendRecord(sessionId, {
    kind: "turn_state",
    run,
    state: "reapplied",
    createdAt: Date.now(),
  } satisfies TurnStateRecord);
  return { ok: true, applied, skipped };
}
