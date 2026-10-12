import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveWorkspacePath } from "@zen/tools-fs";

import { sessionCacheDir } from "./zen-dir";

import type { FileCheckpoint } from "@zen/shared";

/**
 * 会话文件快照（检查点）：Agent 写/改文件前把工作区原文件备份到
 * ~/.zen/cache/sessions/<sessionId>/checkpoints/，manifest.jsonl 逐行追加记录，
 * 支持列出与恢复（对非 git 工作区是唯一的回退手段）。
 */

function checkpointsDir(sessionId: string): string {
  return join(sessionCacheDir(sessionId), "checkpoints");
}

function manifestFile(sessionId: string): string {
  return join(checkpointsDir(sessionId), "manifest.jsonl");
}

/** 备份文件名：`/` 换 `__` 保证平铺在 checkpoints 目录下 */
function backupFileName(relativePath: string, createdAt: number): string {
  return `${createdAt}-${relativePath.replace(/\//g, "__")}`;
}

function isFileCheckpoint(value: unknown): value is FileCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FileCheckpoint>;
  return (
    typeof item.id === "string" &&
    typeof item.relativePath === "string" &&
    typeof item.backupFile === "string" &&
    typeof item.createdAt === "number"
  );
}

/**
 * 写/改文件前备份原文件。文件不存在（新建）或路径越界返回 null；
 * 其余错误向上抛，由调用方（checkpointBridge）吞掉以免阻塞写入。
 */
export async function backupWorkspaceFile(
  sessionId: string,
  workspaceRoot: string,
  relativePath: string,
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
  const backupFile = join(dir, backupFileName(relativePath, createdAt));
  try {
    await mkdir(dir, { recursive: true });
    // 直接复制探测存在性：ENOENT 即文件不存在（新建无需备份）
    await copyFile(fullPath, backupFile);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const checkpoint: FileCheckpoint = {
    id: randomUUID(),
    sessionId,
    relativePath,
    backupFile,
    createdAt,
  };
  await appendFile(manifestFile(sessionId), `${JSON.stringify(checkpoint)}\n`, "utf8");
  return checkpoint;
}

/** 列出会话全部文件快照，最新在前；manifest 坏行跳过不崩 */
export async function listFileCheckpoints(sessionId: string): Promise<FileCheckpoint[]> {
  let raw: string;
  try {
    raw = await readFile(manifestFile(sessionId), "utf8");
  } catch {
    return [];
  }
  const items: FileCheckpoint[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isFileCheckpoint(parsed)) {
        items.push(parsed);
      }
    } catch {
      // 坏行跳过：manifest 是追加型日志，个别损坏不应影响其余记录
    }
  }
  return items.reverse();
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
  try {
    const fullPath = resolveWorkspacePath(workspaceRoot, found.relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await copyFile(found.backupFile, fullPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
