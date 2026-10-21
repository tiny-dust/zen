import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cacheRoot: "" }));

// zen-dir 顶层 import electron；sessionCacheDir 重定向到 tmp 做测试隔离
vi.mock("./zen-dir", () => ({
  sessionCacheDir: (sessionId: string) => join(state.cacheRoot, sessionId),
}));

import {
  backupAfterWrite,
  backupWorkspaceFile,
  beginTurnCheckpoint,
  listFileCheckpoints,
  listTurnCheckpoints,
  reapplyTurnCheckpoints,
  restoreFileCheckpoint,
  undoTurnCheckpoints,
} from "./session-checkpoints";

import type { FileCheckpoint } from "@zen/shared";

let workspaceRoot = "";

beforeAll(() => {
  state.cacheRoot = mkdtempSync(join(tmpdir(), "zen-cp-cache-"));
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-cp-ws-"));
});

afterAll(() => {
  rmSync(state.cacheRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 模拟 checkpointBridge 的完整写入流：改前备份 → 写入 → 改后副本 */
async function writeTracked(
  sessionId: string,
  run: number,
  rel: string,
  content: string,
): Promise<void> {
  const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, rel, run);
  expect(checkpoint).not.toBeNull();
  const fullPath = join(workspaceRoot, rel);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
  await backupAfterWrite(sessionId, workspaceRoot, rel, checkpoint?.id ?? "");
}

function readWorkspace(rel: string): string {
  return readFileSync(join(workspaceRoot, rel), "utf8");
}

function backupDir(sessionId: string): string {
  return join(state.cacheRoot, sessionId, "checkpoints");
}

describe("session-checkpoints", () => {
  it("备份 → 列表 → 恢复 roundtrip", async () => {
    const sessionId = "sess-cp-1";
    writeFileSync(join(workspaceRoot, "app.txt"), "v1");

    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "app.txt", 1);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.sessionId).toBe(sessionId);
    expect(checkpoint?.relativePath).toBe("app.txt");
    expect(checkpoint?.run).toBe(1);
    expect(readFileSync(checkpoint?.backupFile ?? "", "utf8")).toBe("v1");

    const items = await listFileCheckpoints(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(checkpoint?.id);
    expect(items[0]?.createdAt).toBe(checkpoint?.createdAt);

    writeFileSync(join(workspaceRoot, "app.txt"), "v2-overwritten");
    const restored = await restoreFileCheckpoint(sessionId, workspaceRoot, checkpoint?.id ?? "");
    expect(restored.ok).toBe(true);
    expect(readWorkspace("app.txt")).toBe("v1");
  });

  it("嵌套路径备份并在目录被删后恢复（mkdir -p）", async () => {
    const sessionId = "sess-cp-2";
    mkdirSync(join(workspaceRoot, "sub/dir"), { recursive: true });
    writeFileSync(join(workspaceRoot, "sub/dir/a.txt"), "nested");

    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "sub/dir/a.txt", 1);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.backupFile).toContain("sub__dir__a.txt");

    rmSync(join(workspaceRoot, "sub"), { recursive: true, force: true });
    const restored = await restoreFileCheckpoint(sessionId, workspaceRoot, checkpoint?.id ?? "");
    expect(restored.ok).toBe(true);
    expect(readWorkspace("sub/dir/a.txt")).toBe("nested");
  });

  it("新建文件记录无改前副本；路径越界返回 null", async () => {
    const sessionId = "sess-cp-3";
    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "missing.txt", 1);
    // 新建文件也入 manifest（撤销时按新建移除），但没有 before 副本
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.backupFile).toBeUndefined();

    // 无 before 副本的检查点不支持单文件恢复
    const restored = await restoreFileCheckpoint(sessionId, workspaceRoot, checkpoint?.id ?? "");
    expect(restored.ok).toBe(false);
    expect(restored.error).toBeTruthy();

    await expect(
      backupWorkspaceFile(sessionId, workspaceRoot, "../outside.txt", 1),
    ).resolves.toBeNull();
  });

  it("恢复不存在的 checkpoint id 返回 { ok:false, error }", async () => {
    const result = await restoreFileCheckpoint("sess-cp-4", workspaceRoot, "no-such-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("manifest 坏行跳过不崩，合法记录仍返回", async () => {
    const sessionId = "sess-cp-5";
    writeFileSync(join(workspaceRoot, "bad.txt"), "keep");
    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "bad.txt", 1);
    expect(checkpoint).not.toBeNull();

    const manifest = join(backupDir(sessionId), "manifest.jsonl");
    appendFileSync(manifest, "not-json\n");
    appendFileSync(manifest, `${JSON.stringify({ garbage: true })}\n`);

    const items = await listFileCheckpoints(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(checkpoint?.id);
  });

  it("turn 标记自增，且按历史最大 run 续号", async () => {
    const sessionId = "sess-cp-turn";
    expect(await beginTurnCheckpoint(sessionId)).toBe(1);
    expect(await beginTurnCheckpoint(sessionId)).toBe(2);
    // manifest 含 run=2 的文件记录时也要从 2 续到 3
    await backupWorkspaceFile(sessionId, workspaceRoot, "t.txt", 2);
    expect(await beginTurnCheckpoint(sessionId)).toBe(3);
  });

  it("按轮分组：fileCount 去重、最新轮在前、撤销状态随 undo/reapply 变化", async () => {
    const sessionId = "sess-cp-group";
    const run1 = await beginTurnCheckpoint(sessionId);
    writeFileSync(join(workspaceRoot, "g-a.txt"), "a0");
    await writeTracked(sessionId, run1, "g-a.txt", "a1");
    await writeTracked(sessionId, run1, "g-b.txt", "b1");
    const run2 = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run2, "g-a.txt", "a2");

    const groups = await listTurnCheckpoints(sessionId);
    expect(groups.map((g) => [g.run, g.fileCount])).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(groups.every((g) => !g.undone)).toBe(true);

    const undone = await undoTurnCheckpoints(sessionId, workspaceRoot, run2);
    expect(undone.ok).toBe(true);
    const afterUndo = await listTurnCheckpoints(sessionId);
    expect(afterUndo[0]?.undone).toBe(true);
    expect(afterUndo[1]?.undone).toBe(false);

    const reapplied = await reapplyTurnCheckpoints(sessionId, workspaceRoot, run2);
    expect(reapplied.ok).toBe(true);
    const afterReapply = await listTurnCheckpoints(sessionId);
    expect(afterReapply[0]?.undone).toBe(false);

    // 清场：后续用例不与该会话的 run 序号互相干扰（每个用例独立 sessionId）
  });

  it("撤销一轮：恢复改前副本 + 移除新建文件；重套用恢复改后副本", async () => {
    const sessionId = "sess-cp-undo";
    writeFileSync(join(workspaceRoot, "u-a.txt"), "before");
    const run = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run, "u-a.txt", "after-a");
    await writeTracked(sessionId, run, "sub/u-new.txt", "created");

    const undone = await undoTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(undone.ok).toBe(true);
    expect(undone.applied).toBe(2);
    // 既有文件回改前，新建文件被移除（after 副本仍在，可重新套用找回）
    expect(readWorkspace("u-a.txt")).toBe("before");
    expect(existsSync(join(workspaceRoot, "sub/u-new.txt"))).toBe(false);

    // 重套用：两个文件都回到改后内容（目录被移除后 mkdir -p 补目录）
    const reapplied = await reapplyTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(reapplied.ok).toBe(true);
    expect(reapplied.applied).toBe(2);
    expect(readWorkspace("u-a.txt")).toBe("after-a");
    expect(readWorkspace("sub/u-new.txt")).toBe("created");
  });

  it("同一文件同轮多次写：撤销回最早改前、重套用回最后改后", async () => {
    const sessionId = "sess-cp-multi";
    writeFileSync(join(workspaceRoot, "m.txt"), "v0");
    const run = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run, "m.txt", "v1");
    await writeTracked(sessionId, run, "m.txt", "v2");

    const undone = await undoTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(undone.ok).toBe(true);
    expect(readWorkspace("m.txt")).toBe("v0");

    const reapplied = await reapplyTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(reapplied.ok).toBe(true);
    expect(readWorkspace("m.txt")).toBe("v2");
  });

  it("轮次与状态守卫：更新轮未撤销时拒绝、重复撤销/未撤销重套用拒绝", async () => {
    const sessionId = "sess-cp-guard";
    writeFileSync(join(workspaceRoot, "guard.txt"), "base");
    const run1 = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run1, "guard.txt", "r1");
    const run2 = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run2, "guard.txt", "r2");

    // 更新的 run2 未撤销：撤销 run1 被拒
    const blocked = await undoTurnCheckpoints(sessionId, workspaceRoot, run1);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("更新");

    // 未撤销就重套用被拒
    const premature = await reapplyTurnCheckpoints(sessionId, workspaceRoot, run2);
    expect(premature.ok).toBe(false);

    // 正常撤销 run2 → run1 可撤销；重复撤销 run2 被拒
    const undo2 = await undoTurnCheckpoints(sessionId, workspaceRoot, run2);
    expect(undo2.ok).toBe(true);
    const undo1 = await undoTurnCheckpoints(sessionId, workspaceRoot, run1);
    expect(undo1.ok).toBe(true);
    expect(readWorkspace("guard.txt")).toBe("base");
    const repeat = await undoTurnCheckpoints(sessionId, workspaceRoot, run2);
    expect(repeat.ok).toBe(false);
    expect(repeat.error).toContain("已撤销");

    // 不存在的轮
    const missing = await undoTurnCheckpoints(sessionId, workspaceRoot, 99);
    expect(missing.ok).toBe(false);
  });

  it("副本缺失降级：缺 before/after 副本的文件跳过，其余正常处理", async () => {
    const sessionId = "sess-cp-missing";
    writeFileSync(join(workspaceRoot, "k-keep.txt"), "keep0");
    writeFileSync(join(workspaceRoot, "k-drop.txt"), "drop0");
    const run = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run, "k-keep.txt", "keep1");
    await writeTracked(sessionId, run, "k-drop.txt", "drop1");

    // 删掉 k-drop 的所有副本文件（模拟缓存被清理）
    const items = await listFileCheckpoints(sessionId);
    const drop: FileCheckpoint | undefined = items.find((item) => item.relativePath === "k-drop.txt");
    expect(drop).toBeTruthy();
    expect(drop?.backupFile).toBeTruthy();
    rmSync(drop?.backupFile ?? "", { force: true });
    rmSync(drop?.afterFile ?? "", { force: true });

    const undone = await undoTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(undone.ok).toBe(true);
    expect(undone.applied).toBe(1);
    expect(undone.skipped).toBe(1);
    expect(readWorkspace("k-keep.txt")).toBe("keep0");

    // 重套用：k-drop 无 after 副本被跳过，但整体仍成功
    const reapplied = await reapplyTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(reapplied.ok).toBe(true);
    expect(reapplied.applied).toBe(1);
    expect(reapplied.skipped).toBe(1);
    expect(readWorkspace("k-keep.txt")).toBe("keep1");
  });

  it("全部副本缺失时返回 { ok:false }（失败安全）", async () => {
    const sessionId = "sess-cp-allmissing";
    writeFileSync(join(workspaceRoot, "z.txt"), "z0");
    const run = await beginTurnCheckpoint(sessionId);
    await writeTracked(sessionId, run, "z.txt", "z1");
    const items = await listFileCheckpoints(sessionId);
    for (const item of items) {
      rmSync(item.backupFile ?? "", { force: true });
    }
    const undone = await undoTurnCheckpoints(sessionId, workspaceRoot, run);
    expect(undone.ok).toBe(false);
    expect(undone.error).toBeTruthy();
  });
});
