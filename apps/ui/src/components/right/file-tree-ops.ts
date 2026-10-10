/** 工作区文件树右键操作的纯逻辑：粘贴目标目录、重命名后的路径前缀替换（供 FilePanel 与测试复用） */

/** 右键菜单动作：由 FileTreeNode 上报、FilePanel 统一处理 */
export type FileTreeAction =
  | "open"
  | "reveal"
  | "copy-relative"
  | "copy-absolute"
  | "copy"
  | "paste"
  | "rename"
  | "delete";

/** 父目录相对路径（顶层条目 → 根 ""） */
export function parentDirPath(rel: string): string {
  const index = rel.lastIndexOf("/");
  return index <= 0 ? "" : rel.slice(0, index);
}

/** 目录 + 名称 → 相对路径（dir 为根 "" 时直接返回名称） */
export function joinRelPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** path 是否位于 prefix 下（含自身；prefix "" 视为工作区根，恒为真） */
export function isPathUnder(path: string, prefix: string): boolean {
  if (!prefix) {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** 重命名后 path 的新值；path 不在重命名条目范围内时返回 null */
export function remapPathAfterRename(path: string, fromRel: string, toRel: string): string | null {
  if (!fromRel) {
    return null;
  }
  if (path === fromRel) {
    return toRel;
  }
  if (path.startsWith(`${fromRel}/`)) {
    return `${toRel}/${path.slice(fromRel.length + 1)}`;
  }
  return null;
}

/** 重命名目录后同步路径集合（expanded 等）：仅替换命中前缀的条目，其余原样保留 */
export function remapSetAfterRename(
  paths: Iterable<string>,
  fromRel: string,
  toRel: string,
): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    next.add(remapPathAfterRename(path, fromRel, toRel) ?? path);
  }
  return next;
}

/** 粘贴目标目录：目录用自身，文件用其父目录；树空白处右键传 ("", true) 得到根 */
export function pasteTargetDir(rel: string, isDir: boolean): string {
  return isDir ? rel : parentDirPath(rel);
}
