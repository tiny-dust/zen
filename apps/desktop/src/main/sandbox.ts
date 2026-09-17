import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SandboxMode } from "@zen/shared";
import { zenSandboxRoot } from "./zen-dir";

/**
 * 项目隔离区（ADR-004）：isolated 模式下把项目复制到 ~/.zen/sandbox/<项目名>/
 * （排除生成物），agent 的 workspaceRoot 指向隔离副本，保证源项目不被直接改动。
 */

const COPY_EXCLUDED = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".venv",
  "__pycache__",
  ".cache",
  "release",
]);

export function sandboxDirFor(projectPath: string): string {
  // 项目名取 basename；hash 后缀避免同名项目冲突
  const name = projectPath.split("/").filter(Boolean).pop() ?? "project";
  const hash = Math.abs([...projectPath].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7))
    .toString(36)
    .slice(0, 6);
  return join(zenSandboxRoot(), `${name}-${hash}`);
}

async function copyProject(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (src) => {
      const name = src.split("/").filter(Boolean).pop() ?? "";
      return !COPY_EXCLUDED.has(name);
    },
  });
}

/**
 * 解析会话实际工作目录：
 * - direct 模式：原目录
 * - isolated 模式：首次复制项目到隔离区并复用；源目录缺失时回退原目录
 */
export async function resolveWorkspaceDir(
  projectPath: string,
  mode: SandboxMode,
): Promise<{ dir: string; isolated: boolean; reused: boolean }> {
  if (mode !== "isolated") {
    return { dir: projectPath, isolated: false, reused: false };
  }
  const target = sandboxDirFor(projectPath);
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      return { dir: target, isolated: true, reused: true };
    }
  } catch {
    // 不存在则复制
  }
  try {
    await copyProject(projectPath, target);
    return { dir: target, isolated: true, reused: false };
  } catch {
    // 复制失败（权限等）回退直接模式，不阻塞会话
    return { dir: projectPath, isolated: false, reused: false };
  }
}

/** 重建隔离区：删除副本后重新复制 */
export async function rebuildSandbox(projectPath: string): Promise<string> {
  const target = sandboxDirFor(projectPath);
  await rm(target, { recursive: true, force: true });
  await copyProject(projectPath, target);
  return target;
}
