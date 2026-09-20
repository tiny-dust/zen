/** 正文内行内 code 是否像文件/目录引用（Response 路径 chip 用） */

const FILE_REF_RE =
  /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])*[\w@-]+\.[A-Za-z][\w-]{0,7}(?::\d+|#L\d+)?$/
/** 以 / 或 \ 结尾的路径段 */
const DIR_WITH_SLASH_RE = /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])+$/
/** 多段路径（至少一段 + 末段），用于识别 packages/shared 这类无斜杠结尾目录 */
const MULTI_SEGMENT_RE = /^(?:(?:[A-Za-z]:)?[./\\])?(?:[\w@.-]+[\\/])+[\w@.-]+$/
const EXT_SUFFIX_RE = /\.[A-Za-z][\w-]{0,7}(?::\d+|#L\d+)?$/
const LINE_SUFFIX_RE = /(?::\d+|#L\d+)$/
// Markdown destinations can contain spaces and Unicode, unlike inline code.
const LINK_RELATIVE_PATH_RE = /^(?:[\p{L}\p{N}\p{M}_@.%?# -]+[\\/])+[\p{L}\p{N}\p{M}_@.%?# -]+[\\/]?$/u

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

export function localFilePathFromHref(href: string): string | null {
  const value = href.trim()
  if (!value || value.startsWith("#") || value.startsWith("//")) {
    return null
  }

  try {
    if (/^file:\/\//i.test(value)) {
      const url = new URL(value)
      if (url.hostname && url.hostname !== "localhost") return null
      const path = decodeURIComponent(normalizePathRef(url.pathname))
      return /[\u0000-\u001f]/.test(path) || /^[\\/]{2}/.test(path) ? null : path
    }
    // Reject all URI schemes, while retaining Windows drive paths.
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)
      && !(/:\d+$/.test(value) && classifyPathRef(value) === "file")) return null
    if (value.includes("?") || /#(?!L\d+$)/.test(value)) return null
    const path = decodeURIComponent(normalizePathRef(value))
    if (/[\u0000-\u001f]/.test(path) || /^[\\/]{2}/.test(path)) return null
    return classifyPathRef(path)
      || LINK_RELATIVE_PATH_RE.test(path)
      || /^(?:\.{1,2}\/|\/|[a-z]:[\\/])/i.test(path)
      ? path
      : null
  }
  catch {
    return null
  }
}