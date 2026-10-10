import { cp, readdir, readFile, rename as renameFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ipcMain, shell } from "electron";

import { duplicateName } from "./workspace-copy-name";

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

  // 重命名文件/目录：目标名不允许路径分隔符；目标已存在时报错（不覆盖）。
  // 通道名不能叫 workspace:rename——已被工作区分组重命名占用（session-ipc.ts）。
  ipcMain.handle(
    "workspace:rename-entry",
    async (
      _event,
      cwd?: string,
      relPath?: string,
      newName?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!relPath || typeof newName !== "string" || !newName.trim()) {
        return { ok: false, error: "path and newName are required" };
      }
      const name = newName.trim();
      if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        return { ok: false, error: "newName must be a plain file name" };
      }
      const root = cwd || process.cwd();
      const src = resolveInsideRoot(root, relPath);
      if (!src) {
        return { ok: false, error: "path escapes workspace" };
      }
      try {
        const dest = join(dirname(src), name);
        if (await stat(dest).catch(() => null)) {
          return { ok: false, error: "target already exists" };
        }
        await renameFile(src, dest);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "rename failed" };
      }
    },
  );

  // 删除到系统废纸篓（shell.trashItem：macOS Finder / Windows 回收站 / Linux XDG trash）
  ipcMain.handle(
    "workspace:trash",
    async (_event, cwd?: string, relPath?: string): Promise<{ ok: boolean; error?: string }> => {
      if (!relPath) {
        return { ok: false, error: "path is required" };
      }
      const root = cwd || process.cwd();
      const target = resolveInsideRoot(root, relPath);
      if (!target) {
        return { ok: false, error: "path escapes workspace" };
      }
      try {
        await shell.trashItem(target);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "trash failed" };
      }
    },
  );

  // 递归复制到目标目录：同目录粘贴自动生成「name 副本」避免覆盖；
  // 跨目录目标已存在时报错；禁止把目录复制进自身子目录（会无限递归）。
  ipcMain.handle(
    "workspace:copy",
    async (
      _event,
      cwd?: string,
      srcRel?: string,
      destDirRel?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!srcRel) {
        return { ok: false, error: "src is required" };
      }
      const root = cwd || process.cwd();
      const src = resolveInsideRoot(root, srcRel);
      const destDir = resolveInsideRoot(root, destDirRel ?? "");
      if (!src || !destDir) {
        return { ok: false, error: "path escapes workspace" };
      }
      try {
        const info = await stat(src);
        if (!info.isDirectory() && !info.isFile()) {
          return { ok: false, error: "unsupported source" };
        }
        if (!(await stat(destDir)).isDirectory()) {
          return { ok: false, error: "destination is not a directory" };
        }
        if (info.isDirectory() && (destDir === src || destDir.startsWith(src + sep))) {
          return { ok: false, error: "cannot copy a directory into itself" };
        }
        const original = basename(src);
        let destName = original;
        const destExists = async (name: string) =>
          !!(await stat(join(destDir, name)).catch(() => null));
        if (await destExists(destName)) {
          if (dirname(src) !== destDir) {
            return { ok: false, error: "target already exists" };
          }
          for (let i = 1; i <= 99; i += 1) {
            const candidate = duplicateName(original, i);
            if (!(await destExists(candidate))) {
              destName = candidate;
              break;
            }
          }
          if (destName === original) {
            return { ok: false, error: "too many duplicates" };
          }
        }
        await cp(src, join(destDir, destName), { recursive: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "copy failed" };
      }
    },
  );
}

/** 相对路径解析到工作区内；越界（..、绝对路径）返回 null。relPath 为空串时解析为根。 */
function resolveInsideRoot(root: string, relPath: string | undefined): string | null {
  if (relPath === undefined) {
    return null;
  }
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  return target;
}
