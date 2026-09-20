import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

export interface ReadFileResult {
  path: string;
  content: string;
}

export interface WriteFileResult extends ReadFileResult {
  before: string | null;
  after: string;
}

export interface EditFileResult {
  path: string;
  /** 本次替换发生的次数（0 表示未命中） */
  replacements: number;
  before: string;
  after: string;
}

export interface DirListResult {
  path: string;
  entries: Array<{ name: string; isDir: boolean }>;
}

export interface FileSearchHit {
  path: string;
  /** 命中行号（内容搜索时），名称搜索为 0 */
  line: number;
  /** 命中行文本（截断到 200 字符） */
  snippet: string;
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.length === 0);
}

function toSlash(path: string): string {
  return path.replace(/\\/g, "/");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (isEmpty(relativePath)) {
    throw new Error("path is required");
  }
  if (isAbsolute(relativePath)) {
    throw new Error(`absolute path is not allowed: ${relativePath}`);
  }
  const root = toSlash(normalize(workspaceRoot));
  const full = toSlash(normalize(join(workspaceRoot, relativePath)));
  if (full !== root && !full.startsWith(`${root}/`)) {
    throw new Error(`path escapes workspace: ${relativePath}`);
  }
  return full;
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<ReadFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const content = await readFile(fullPath, "utf8");
    return { path: relativePath, content };
  } catch (error) {
    throw new Error(`failed to read ${relativePath}: ${toErrorMessage(error)}`);
  }
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<WriteFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  let before: string | null = null;
  try {
    before = await readFile(fullPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error(`failed to read ${relativePath} before writing: ${toErrorMessage(error)}`);
    }
  }
  try {
    await writeFile(fullPath, content, "utf8");
    return { path: relativePath, content, before, after: content };
  } catch (error) {
    throw new Error(`failed to write ${relativePath}: ${toErrorMessage(error)}`);
  }
}

/**
 * 精确字符串替换编辑：oldString 必须在文件中唯一命中（或指定 replaceAll），
 * 避免整文件覆写带来的意外丢失。
 */
export async function editWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<EditFileResult> {
  if (isEmpty(oldString)) {
    throw new Error("oldString is required");
  }
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const content = await readFile(fullPath, "utf8");
    const first = content.indexOf(oldString);
    if (first < 0) {
      return { path: relativePath, replacements: 0, before: content, after: content };
    }
    if (!replaceAll && content.indexOf(oldString, first + 1) >= 0) {
      throw new Error(
        `oldString matches multiple locations in ${relativePath}; provide more context or set replaceAll`,
      );
    }
    const next = replaceAll
      ? content.split(oldString).join(newString)
      : content.slice(0, first) + newString + content.slice(first + oldString.length);
    await writeFile(fullPath, next, "utf8");
    const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
    return { path: relativePath, replacements, before: content, after: next };
  } catch (error) {
    throw new Error(`failed to edit ${relativePath}: ${toErrorMessage(error)}`);
  }
}

/** 单层目录列表（不递归），路径越界直接拒绝 */
export async function listWorkspaceDir(
  workspaceRoot: string,
  relativePath: string,
): Promise<DirListResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return {
    path: relativePath,
    entries: entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)),
  };
}

const SEARCH_IGNORED = new Set(["node_modules", ".git", "dist", "out", "build"]);
const SEARCH_MAX_FILES = 800;
const SEARCH_MAX_HITS = 40;

/**
 * 工作区搜索：mode="name" 按文件名，mode="content" 按文本行。
 * 纯 Node 实现（无 rg 依赖），量级按小上限设计。
 */
export async function searchWorkspaceFiles(
  workspaceRoot: string,
  query: string,
  mode: "name" | "content",
): Promise<FileSearchHit[]> {
  if (isEmpty(query)) {
    throw new Error("query is required");
  }
  const root = toSlash(normalize(workspaceRoot));
  const needle = query.toLowerCase();
  const hits: FileSearchHit[] = [];
  let scanned = 0;

  async function walk(dir: string, rel: string): Promise<void> {
    if (hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) {
      return;
    }
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) {
        return;
      }
      if (SEARCH_IGNORED.has(name) || name.startsWith(".")) {
        continue;
      }
      const abs = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try {
        isDir = await statIsDir(abs);
      } catch {
        continue;
      }
      if (isDir) {
        await walk(abs, relPath);
        continue;
      }
      scanned += 1;
      if (mode === "name") {
        if (name.toLowerCase().includes(needle)) {
          hits.push({ path: relPath, line: 0, snippet: name });
        }
        continue;
      }
      // content：文本行匹配（跳过二进制疑似文件）
      let content: string;
      try {
        const buffer = await readFile(abs);
        if (buffer.length > 512 * 1024 || buffer.includes(0)) {
          continue;
        }
        content = buffer.toString("utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]?.toLowerCase().includes(needle)) {
          hits.push({
            path: relPath,
            line: i + 1,
            snippet: (lines[i] ?? "").trim().slice(0, 200),
          });
          if (hits.length >= SEARCH_MAX_HITS) {
            return;
          }
        }
      }
    }
  }

  await walk(root, "");
  return hits;
}

async function statIsDir(path: string): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  const info = await stat(path);
  return info.isDirectory();
}
