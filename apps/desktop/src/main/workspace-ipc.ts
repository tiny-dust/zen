import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { ipcMain } from "electron";

import type { WorkspaceFile } from "@zen/shared";

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
  ipcMain.handle("workspace:list-files", async (_event, cwd?: string): Promise<WorkspaceFile[]> => {
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
  });
}
