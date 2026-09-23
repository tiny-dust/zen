/** 消息流文件引用的路径处理：行号锚点、正斜杠化、绝对化与工作区相对化 */

/** 统一为正斜杠，并去掉前导 ./ */
export function toPosixPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Unix 根路径或 Windows 盘符路径 */
export function isAbsolutePathLike(path: string): boolean {
  return /^(?:\/|[A-Za-z]:\/)/.test(toPosixPath(path));
}

/** 拆掉尾部行号锚点（:12 / #L12）；无锚点时 line 为 undefined */
export function splitLineAnchor(ref: string): { file: string; line?: number } {
  const value = ref.trim();
  const match = /^(.*?)(?::(\d+)|#L(\d+))$/.exec(value);
  const line = match ? Number(match[2] ?? match[3]) : NaN;
  if (!match?.[1] || !Number.isFinite(line) || line < 1) {
    return { file: value };
  }
  return { file: match[1], line };
}

/** 引用 → 绝对路径（相对引用挂到工作区根；无根时只做正斜杠化） */
export function resolveFileRefPath(ref: string, root?: string | null): string {
  const posix = toPosixPath(splitLineAnchor(ref).file);
  if (isAbsolutePathLike(posix) || !root) {
    return posix;
  }
  return `${toPosixPath(root).replace(/\/+$/, "")}/${posix}`;
}

/** 绝对路径位于工作区内 → 工作区相对路径，否则 null（Windows 盘符不区分大小写） */
export function toWorkspaceRelativePath(abs: string, root?: string | null): string | null {
  if (!root) {
    return null;
  }
  const posix = toPosixPath(abs);
  const base = toPosixPath(root).replace(/\/+$/, "");
  if (!base || !isAbsolutePathLike(posix)) {
    return null;
  }
  const drive = /^[A-Za-z]:\//.test(posix) && /^[A-Za-z]:\//.test(base);
  const matchesBase = drive
    ? posix.toLowerCase().startsWith(`${base.toLowerCase()}/`) || posix.toLowerCase() === base.toLowerCase()
    : posix.startsWith(`${base}/`) || posix === base;
  if (!matchesBase) {
    return null;
  }
  return posix === base ? "" : posix.slice(base.length + 1);
}
