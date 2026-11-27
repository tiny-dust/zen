/**
 * 命令面板的匹配规则：空格分隔的多个词各自做子序列匹配，全部命中才算命中。
 * 例：「fb」命中「FileBrowser」，「rb 面板」命中「描述里带 面板 的 ResizableBar」。
 */
export function matchesSearch(value: string, keywords: string[] | undefined, search: string): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) {
    return true
  }
  const haystacks = [value, ...(keywords ?? [])].map((item) => item.toLowerCase())
  return terms.every((term) => haystacks.some((hay) => isSubsequence(term, hay)))
}

function isSubsequence(term: string, haystack: string): boolean {
  let cursor = 0
  for (const char of haystack) {
    if (char === term[cursor]) {
      cursor += 1
      if (cursor === term.length) {
        return true
      }
    }
  }
  return false
}
