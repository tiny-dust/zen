import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

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
  /** 未命中时的自纠错线索：疑似相似行号与建议（命中时无此字段） */
  hint?: string;
}

export interface DirListResult {
  path: string;
  entries: Array<{ name: string; isDir: boolean }>;
  /** 条目超过上限被裁剪 */
  truncated?: boolean;
}

export interface FileSearchHit {
  path: string;
  /** 命中行号（内容搜索时），名称搜索为 0 */
  line: number;
  /** 命中行文本（截断到 200 字符） */
  snippet: string;
}

export interface FileSearchResult {
  hits: FileSearchHit[];
  /** 命中数或扫描范围达上限，结果不完整（调用方应提示模型缩小范围） */
  truncated: boolean;
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

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code ?? "")
    : undefined;
}

/** 模型常见入参畸形：首尾引号包裹 / 前后空白（GPT 系高频） */
function unquote(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"])(.*)\1$/s);
  return match?.[2] ? match[2].trim() : trimmed;
}

/**
 * 文件工具路径解析：相对路径基于工作区根，绝对路径（含工作区外）直接使用。
 * `~` / `~/x` 展开为用户主目录。仅清洗后的空路径与 POSIX 上的 Windows 盘符
 * 相对路径（C:/x，非绝对、join 会拼出怪路径）报错。
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (isEmpty(relativePath)) {
    throw new Error("path is required (relative to the workspace root, e.g. src/main.ts)");
  }
  // 模型常见畸形入参统一清洗：引号/空白已去，Windows 分隔符统一为 /（POSIX 上
  // join 不会转换 \，会把 "a\b.ts" 当成单个文件名导致 not found）
  const cleaned = toSlash(unquote(relativePath));
  if (cleaned === "~" || cleaned.startsWith("~/")) {
    return toSlash(normalize(join(homedir(), cleaned.slice(1))));
  }
  // POSIX 上 Windows 盘符路径（C:/x）不是绝对路径，join 会拼出奇怪的工作区内嵌套路径，
  // 报错难以理解；直接拒绝并给出指引（Windows 上是真绝对路径，正常放行）
  if (!isAbsolute(cleaned) && /^[A-Za-z]:\//.test(cleaned)) {
    throw new Error(
      `path is not valid on this platform: ${relativePath} (Windows drive-letter paths are not supported here; use runTerminal)`,
    );
  }
  const candidate = isAbsolute(cleaned)
    ? toSlash(normalize(cleaned))
    : toSlash(normalize(join(workspaceRoot, cleaned)));
  if (!isAbsolute(candidate)) {
    throw new Error(`path does not resolve to an absolute path: ${relativePath}`);
  }
  return candidate;
}

/** 结果展示路径：工作区内转回相对形式；工作区外用归一化绝对路径 */
function toDisplayPath(workspaceRoot: string, fullPath: string, _rawInput: string): string {
  const root = toSlash(normalize(workspaceRoot));
  if (fullPath === root) {
    return ".";
  }
  if (fullPath.startsWith(`${root}/`)) {
    return fullPath.slice(root.length + 1);
  }
  return fullPath;
}

/** readFile 单次读取上限：超大文件只读前缀并附说明，避免整文件载入内存/上下文 */
const MAX_READ_BYTES = 2 * 1024 * 1024;
/** 二进制嗅探窗口：开头含 NUL 字节即视为非文本 */
const BINARY_SNIFF_BYTES = 8192;

export async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<ReadFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  const display = toDisplayPath(workspaceRoot, fullPath, relativePath);
  let size = 0;
  try {
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      throw new Error(`${display} is a directory; use listDir to list its contents`);
    }
    if (!info.isFile()) {
      throw new Error(`${display} is not a regular file (socket/device/symlink target)`);
    }
    size = info.size;
  } catch (error) {
    if (error instanceof Error && !(errorCode(error) ?? "")) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw new Error(`file not found: ${display} (use listDir to explore the workspace)`);
    }
    throw new Error(`failed to read ${display}: ${toErrorMessage(error)}`);
  }
  let content: string;
  try {
    const handle = await open(fullPath, "r");
    try {
      const limit = Math.min(size, MAX_READ_BYTES);
      const buffer = Buffer.alloc(limit);
      const { bytesRead } = await handle.read(buffer, 0, limit, 0);
      const data = buffer.subarray(0, bytesRead);
      if (data.subarray(0, Math.min(bytesRead, BINARY_SNIFF_BYTES)).includes(0)) {
        throw new Error(
          `${display} appears to be a binary file (UTF-8 text tools cannot read it; use runTerminal for binary files)`,
        );
      }
      content = data.toString("utf8");
      if (bytesRead < size) {
        content += `\n\n[file too large: ${size} bytes in total, only the first ${bytesRead} bytes were read; use searchFiles content mode to query the rest]`;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && !errorCode(error)) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw new Error(`file not found: ${display} (use listDir to explore the workspace)`);
    }
    throw new Error(`failed to read ${display}: ${toErrorMessage(error)}`);
  }
  return { path: display, content };
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<WriteFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  const display = toDisplayPath(workspaceRoot, fullPath, relativePath);
  let before: string | null = null;
  try {
    const info = await stat(fullPath);
    if (info.isFile() && info.size <= MAX_READ_BYTES) {
      // before 用于检查点/历史 diff：超大与二进制文件跳过，避免乱码或巨串进入上下文
      const existing = await readFile(fullPath, "utf8");
      before = existing.slice(0, BINARY_SNIFF_BYTES).includes("\0") ? null : existing;
    }
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR") {
      throw new Error(`failed to read ${display} before writing: ${toErrorMessage(error)}`);
    }
    // 目录（EISDIR）/路径中间是文件（ENOTDIR）交给下面的写入阶段报错
  }
  try {
    // 新文件常落在不存在的子目录里：自动补齐父目录，消除高频 ENOENT 失败
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    return { path: display, content, before, after: content };
  } catch (error) {
    throw new Error(`failed to write ${display}: ${toErrorMessage(error)}`);
  }
}

/** 未命中时给模型的自纠错线索：列出与 oldString 首行相似的行号 */
function buildEditHint(content: string, oldString: string): string | undefined {
  const firstLine = oldString
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return undefined;
  }
  const probe = firstLine.slice(0, 30);
  if (probe.length < 4) {
    return undefined;
  }
  const lines: number[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (lines.length < 5 && line.includes(probe)) {
      lines.push(index + 1);
    }
  });
  if (!lines.length) {
    return undefined;
  }
  return `lines ${lines.join(", ")} look similar; re-read the file and copy the exact text (watch whitespace and line breaks)`;
}

/**
 * 精确字符串替换编辑：oldString 必须在文件中唯一命中（或指定 replaceAll），
 * 避免整文件覆写带来的意外丢失。
 * CRLF 兼容：Windows 检出的文件换行是 \r\n，模型给的 oldString 常是 \n；
 * 直接匹配失败时按 \r\n 形式重试一次，替换结果保持 CRLF。
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
  const display = toDisplayPath(workspaceRoot, fullPath, relativePath);
  let content: string;
  try {
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      throw new Error(`${display} is a directory; editFile needs a file path`);
    }
    content = await readFile(fullPath, "utf8");
  } catch (error) {
    if (error instanceof Error && !errorCode(error)) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw new Error(`file not found: ${display}; create it with writeFile first`);
    }
    throw new Error(`failed to edit ${display}: ${toErrorMessage(error)}`);
  }
  let matchString = oldString;
  let replacement = newString;
  let first = content.indexOf(matchString);
  if (first < 0 && content.includes("\r\n")) {
    const crlfOld = oldString.replace(/\r?\n/g, "\r\n");
    const crlfFirst = content.indexOf(crlfOld);
    if (crlfFirst >= 0) {
      matchString = crlfOld;
      replacement = newString.replace(/\r?\n/g, "\r\n");
      first = crlfFirst;
    }
  }
  if (first < 0) {
    const result: EditFileResult = {
      path: display,
      replacements: 0,
      before: content,
      after: content,
    };
    const hint = buildEditHint(content, oldString);
    if (hint) {
      result.hint = hint;
    }
    return result;
  }
  if (!replaceAll && content.indexOf(matchString, first + 1) >= 0) {
    throw new Error(
      `oldString matches multiple locations in ${display}; provide more context or set replaceAll`,
    );
  }
  const next = replaceAll
    ? content.split(matchString).join(replacement)
    : content.slice(0, first) + replacement + content.slice(first + matchString.length);
  try {
    await writeFile(fullPath, next, "utf8");
  } catch (error) {
    throw new Error(`failed to edit ${display}: ${toErrorMessage(error)}`);
  }
  const replacements = replaceAll ? content.split(matchString).length - 1 : 1;
  return { path: display, replacements, before: content, after: next };
}

const LIST_MAX_ENTRIES = 500;

/** 单层目录列表（不递归），路径越界直接拒绝；空路径表示工作区根目录 */
export async function listWorkspaceDir(
  workspaceRoot: string,
  relativePath: string,
): Promise<DirListResult> {
  const raw = relativePath ?? "";
  const fullPath = isEmpty(raw)
    ? workspaceRoot
    : resolveWorkspacePath(workspaceRoot, raw);
  const display = isEmpty(raw) ? "." : toDisplayPath(workspaceRoot, fullPath, raw);
  let entries: Dirent[];
  try {
    entries = await readdir(fullPath, { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      throw new Error(`directory not found: ${display} (list "." to see the workspace root)`);
    }
    if (code === "ENOTDIR") {
      throw new Error(`not a directory: ${display} (use readFile to read files)`);
    }
    throw new Error(`failed to list ${display}: ${toErrorMessage(error)}`);
  }
  const visible = entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const result: DirListResult = {
    path: display,
    entries: visible.slice(0, LIST_MAX_ENTRIES),
  };
  if (visible.length > LIST_MAX_ENTRIES) {
    result.truncated = true;
  }
  return result;
}

/** 搜索忽略目录：构建产物/依赖目录与编辑器噪声，命中它们对模型只有干扰 */
const SEARCH_IGNORED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".gradle",
  ".idea",
  ".DS_Store",
];
const SEARCH_MAX_FILES = 3000;
const SEARCH_MAX_HITS = 40;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;

let rgAvailable: boolean | null = null;

function hasRipgrep(): boolean {
  if (rgAvailable === null) {
    try {
      const result = spawnSync("rg", ["--version"], { timeout: 3000 });
      rgAvailable = result.status === 0;
    } catch {
      rgAvailable = false;
    }
  }
  return rgAvailable;
}

function rgIgnoreGlobArgs(): string[] {
  const args: string[] = [];
  for (const dir of SEARCH_IGNORED_DIRS) {
    args.push("-g", `!${dir}/`);
  }
  return args;
}

/** ripgrep 文件名搜索：rg --files 全量列出后在内存过滤（rg 尊重显式 glob 排除） */
function rgSearchNames(root: string, query: string): FileSearchResult | null {
  const result = spawnSync(
    "rg",
    ["--files", "--hidden", "--no-messages", "--no-ignore-vcs", ...rgIgnoreGlobArgs()],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15_000 },
  );
  if (result.error || result.status !== 0) {
    return null;
  }
  const needle = query.toLowerCase();
  const hits: FileSearchHit[] = [];
  let truncated = false;
  for (const line of result.stdout.split("\n")) {
    const relPath = line.trim().replace(/\\/g, "/");
    if (!relPath) {
      continue;
    }
    const name = relPath.split("/").pop() ?? relPath;
    if (!name.toLowerCase().includes(needle)) {
      continue;
    }
    if (hits.length >= SEARCH_MAX_HITS) {
      truncated = true;
      break;
    }
    hits.push({ path: relPath, line: 0, snippet: name });
  }
  return { hits, truncated };
}

/** ripgrep 内容搜索：-n 带行号，status 1 = 无命中（正常结果），>1 = 出错回退 */
function rgSearchContent(root: string, query: string): FileSearchResult | null {
  const result = spawnSync(
    "rg",
    [
      "-i",
      "-n",
      "--no-heading",
      "--no-messages",
      "--max-count",
      "3",
      "--max-filesize",
      "512k",
      "--hidden",
      "--no-ignore-vcs",
      ...rgIgnoreGlobArgs(),
      "--",
      query,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15_000 },
  );
  if (result.error || result.status === null || result.status > 1) {
    return null;
  }
  const matched: FileSearchHit[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    matched.push({
      path: (match[1] ?? "").replace(/\\/g, "/"),
      line: Number(match[2] ?? 0),
      snippet: (match[3] ?? "").trim().slice(0, 200),
    });
  }
  return { hits: matched.slice(0, SEARCH_MAX_HITS), truncated: matched.length > SEARCH_MAX_HITS };
}

/**
 * 工作区搜索：mode="name" 按文件名，mode="content" 按文本行。
 * 有 ripgrep 时走 rg（大仓库毫秒级且自动跳过二进制），否则回退纯 Node 遍历。
 */
export async function searchWorkspaceFiles(
  workspaceRoot: string,
  query: string,
  mode: "name" | "content",
): Promise<FileSearchResult> {
  if (isEmpty(query)) {
    throw new Error("query is required");
  }
  const root = toSlash(normalize(workspaceRoot));
  if (hasRipgrep()) {
    const viaRg = mode === "name" ? rgSearchNames(root, query) : rgSearchContent(root, query);
    if (viaRg) {
      return viaRg;
    }
  }
  return searchWorkspaceFilesNode(root, query, mode);
}

/** 纯 Node 回退实现（导出供回归测试）：withFileTypes 单次遍历，不逐文件 stat */
export async function searchWorkspaceFilesNode(
  workspaceRoot: string,
  query: string,
  mode: "name" | "content",
): Promise<FileSearchResult> {
  const needle = query.toLowerCase();
  const hits: FileSearchHit[] = [];
  let scanned = 0;
  let truncated = false;

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) {
        truncated = true;
        return;
      }
      if (SEARCH_IGNORED_DIRS.includes(entry.name)) {
        continue;
      }
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      scanned += 1;
      if (mode === "name") {
        if (entry.name.toLowerCase().includes(needle)) {
          hits.push({ path: relPath, line: 0, snippet: entry.name });
        }
        continue;
      }
      // content：文本行匹配（跳过二进制疑似与超大文件）
      let content: string;
      try {
        const buffer = await readFile(join(dir, entry.name));
        if (buffer.length > SEARCH_MAX_FILE_BYTES || buffer.includes(0)) {
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
            truncated = true;
            return;
          }
        }
      }
    }
  }

  await walk(workspaceRoot, "");
  return { hits, truncated };
}
