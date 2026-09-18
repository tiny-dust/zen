/** 正文内行内 code 是否像文件/目录引用（Response 路径 chip 用） */

const FILE_REF_RE =
  /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])*[\w@-]+\.[A-Za-z][\w-]{0,7}(?::\d+|#L\d+)?$/
/** 以 / 或 \ 结尾的路径段 */
const DIR_WITH_SLASH_RE = /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])+$/
/** 多段路径（至少一段 + 末段），用于识别 packages/shared 这类无斜杠结尾目录 */
const MULTI_SEGMENT_RE = /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])+[\w@.-]+$/
const EXT_SUFFIX_RE = /\.[A-Za-z][\w-]{0,7}(?::\d+|#L\d+)?$/
const LINE_SUFFIX_RE = /(?::\d+|#L\d+)$/

export type PathRefKind = "file" | "dir" | null

export function classifyPathRef(text: string): PathRefKind {
  const value = text.trim()
  // 普通代码/过长片段不当路径；.json 等配置文件路径保留可点击
  if (!value || value.length > 240 || /\s/.test(value) || value.length < 2) {
    return null
  }
  if (FILE_REF_RE.test(value)) {
    return "file"
  }
  if (DIR_WITH_SLASH_RE.test(value)) {
    return "dir"
  }
  // 多段且无文件扩展名：目录（如 packages/shared）
  if (MULTI_SEGMENT_RE.test(value) && !EXT_SUFFIX_RE.test(value)) {
    return "dir"
  }
  return null
}

export function normalizePathRef(text: string): string {
  return text.trim().replace(LINE_SUFFIX_RE, "")
}