import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cacheRoot: "" }));

// zen-dir 顶层 import electron；sessionCacheDir 重定向到 tmp 做测试隔离
vi.mock("./zen-dir", () => ({
  sessionCacheDir: (sessionId: string) => join(state.cacheRoot, sessionId),
}));

import { backupWorkspaceFile, listFileCheckpoints, restoreFileCheckpoint } from "./session-checkpoints";

let workspaceRoot = "";

beforeAll(() => {
  state.cacheRoot = mkdtempSync(join(tmpdir(), "zen-cp-cache-"));
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-cp-ws-"));
});

afterAll(() => {
  rmSync(state.cacheRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("session-checkpoints", () => {
  it("备份 → 列表 → 恢复 roundtrip", async () => {
    const sessionId = "sess-cp-1";
    writeFileSync(join(workspaceRoot, "app.txt"), "v1");

    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "app.txt");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.sessionId).toBe(sessionId);
    expect(checkpoint?.relativePath).toBe("app.txt");
    expect(readFileSync(checkpoint?.backupFile ?? "", "utf8")).toBe("v1");

    const items = await listFileCheckpoints(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(checkpoint?.id);
    expect(items[0]?.createdAt).toBe(checkpoint?.createdAt);

    writeFileSync(join(workspaceRoot, "app.txt"), "v2-overwritten");
    const restored = await restoreFileCheckpoint(sessionId, workspaceRoot, checkpoint?.id ?? "");
    expect(restored.ok).toBe(true);
    expect(readFileSync(join(workspaceRoot, "app.txt"), "utf8")).toBe("v1");
  });

  it("嵌套路径备份并在目录被删后恢复（mkdir -p）", async () => {
    const sessionId = "sess-cp-2";
    mkdirSync(join(workspaceRoot, "sub/dir"), { recursive: true });
    writeFileSync(join(workspaceRoot, "sub/dir/a.txt"), "nested");

    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "sub/dir/a.txt");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.backupFile).toContain("sub__dir__a.txt");

    rmSync(join(workspaceRoot, "sub"), { recursive: true, force: true });
    const restored = await restoreFileCheckpoint(sessionId, workspaceRoot, checkpoint?.id ?? "");
    expect(restored.ok).toBe(true);
    expect(readFileSync(join(workspaceRoot, "sub/dir/a.txt"), "utf8")).toBe("nested");
  });

  it("文件不存在返回 null；路径越界返回 null", async () => {
    const sessionId = "sess-cp-3";
    await expect(backupWorkspaceFile(sessionId, workspaceRoot, "missing.txt")).resolves.toBeNull();
    await expect(
      backupWorkspaceFile(sessionId, workspaceRoot, "../outside.txt"),
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
    const checkpoint = await backupWorkspaceFile(sessionId, workspaceRoot, "bad.txt");
    expect(checkpoint).not.toBeNull();

    const manifest = join(state.cacheRoot, sessionId, "checkpoints", "manifest.jsonl");
    appendFileSync(manifest, "not-json\n");
    appendFileSync(manifest, `${JSON.stringify({ garbage: true })}\n`);

    const items = await listFileCheckpoints(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(checkpoint?.id);
  });
});
