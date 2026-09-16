import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { ipcMain } from "electron";

import type { DirEntry, ReadFileResult, WorkspaceFile } from "@zen/shared";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".coder",
  ".playwright-mcp",
]);

const MAX_FILES = 200;

export function registerWorkspaceIpc(): void {
  ipcMain.handle(
    "workspace:list-files",
    async (_event, cwd?: string): Promise<WorkspaceFile[]> => {
      const root = cwd || process.cwd();
      const results: WorkspaceFile[] = [];

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 2 || results.length >= MAX_FILES) {
          return;
        }
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= MAX_FILES) {
            return;
          }
          if (IGNORED_DIRS.has(entry.name)) {
            continue;
          }
          const abs = join(dir, entry.name);
          const rel = relative(root, abs);
          results.push({ path: rel, name: entry.name, isDir: entry.isDirectory() });
          if (entry.isDirectory()) {
            await walk(abs, depth + 1);
          }
        }
      }

      await walk(root, 0);
      return results;
    },
  );

  // 文件树懒加载：返回单层目录条目；路径越界（..、绝对路径）直接拒绝
  ipcMain.handle(
    "workspace:read-dir",
    async (_event, cwd?: string, relPath = ""): Promise<DirEntry[] | null> => {
      const root = cwd || process.cwd();
      const target = resolve(root, relPath);
      if (target !== root && !target.startsWith(root + sep)) {
        return null;
      }
      try {
        const entries = await readdir(target, { withFileTypes: true });
        return entries
          .filter((entry) => !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith("."))
          .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
          .sort((a, b) =>
            a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
          );
      } catch {
        return null;
      }
    },
  );

  // 只读文件内容：512KB 截断 + 目录/越界拒绝
  ipcMain.handle(
    "workspace:read-file",
    async (_event, cwd?: string, relPath?: string): Promise<ReadFileResult | null> => {
      if (!relPath) {
        return null;
      }
      const root = cwd || process.cwd();
      const target = resolve(root, relPath);
      if (target !== root && !target.startsWith(root + sep)) {
        return null;
      }
      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          return null;
        }
        const MAX = 512 * 1024;
        const buffer = await readFile(target);
        const truncated = buffer.length > MAX;
        const slice = truncated ? buffer.subarray(0, MAX) : buffer;
        if (slice.includes(0)) {
          // 二进制文件不渲染
          return null;
        }
        return {
          content: slice.toString("utf8"),
          size: buffer.length,
          truncated,
        };
      } catch {
        return null;
      }
    },
  );
}
