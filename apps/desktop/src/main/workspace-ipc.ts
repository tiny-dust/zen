import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { ipcMain } from "electron";

import type { DirEntry, FilePreview, ReadFileResult, WorkspaceFile } from "@zen/shared";

/** 常见图片扩展名 → MIME；预览与消息图片共用 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".coder",
  ".playwright-mcp",
]);

const MAX_FILES = 4000;
const MAX_DEPTH = 10;

export function registerWorkspaceIpc(): void {
  ipcMain.handle(
    "workspace:list-files",
    async (_event, cwd?: string): Promise<WorkspaceFile[]> => {
      const root = cwd || process.cwd();
      const results: WorkspaceFile[] = [];

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > MAX_DEPTH || results.length >= MAX_FILES) {
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

  // 写入文本文件：与 read-file 同一套路径沙箱；返回是否成功
  ipcMain.handle(
    "workspace:write-file",
    async (
      _event,
      cwd?: string,
      relPath?: string,
      content?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!relPath || typeof content !== "string") {
        return { ok: false, error: "path and content are required" };
      }
      const root = cwd || process.cwd();
      const target = resolve(root, relPath);
      if (target !== root && !target.startsWith(root + sep)) {
        return { ok: false, error: "path escapes workspace" };
      }
      try {
        const info = await stat(target).catch(() => null);
        if (info?.isDirectory()) {
          return { ok: false, error: "target is a directory" };
        }
        await writeFile(target, content, "utf8");
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "write failed" };
      }
    },
  );

  // 文件预览：图片走 data URL，文本 512KB 截断，其余二进制报 unsupported。
  // 绝对路径直接放行（用户上传/Agent 产物可在工作区外），相对路径按 cwd 解析。
  ipcMain.handle(
    "workspace:preview-file",
    async (_event, cwd?: string, path?: string): Promise<FilePreview | null> => {
      if (!path) {
        return null;
      }
      let ref = path;
      if (/^file:\/\//i.test(ref)) {
        try {
          ref = decodeURIComponent(new URL(ref).pathname);
        } catch {
          return null;
        }
      }
      const root = cwd || process.cwd();
      const target = isAbsolute(ref) ? ref : resolve(root, ref);
      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          return null;
        }
        const ext = target.includes(".") ? target.split(".").pop()!.toLowerCase() : "";
        const mime = IMAGE_MIME[ext];
        if (mime) {
          if (info.size > MAX_IMAGE_BYTES) {
            return { kind: "unsupported", size: info.size };
          }
          const buffer = await readFile(target);
          return {
            kind: "image",
            dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
            size: info.size,
          };
        }
        const MAX = 512 * 1024;
        const buffer = await readFile(target);
        const truncated = buffer.length > MAX;
        const slice = truncated ? buffer.subarray(0, MAX) : buffer;
        if (slice.includes(0)) {
          return { kind: "unsupported", size: buffer.length };
        }
        return { kind: "text", content: slice.toString("utf8"), size: buffer.length, truncated };
      } catch {
        return null;
      }
    },
  );
}
