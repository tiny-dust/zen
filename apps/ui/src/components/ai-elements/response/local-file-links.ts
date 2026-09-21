import type { StreamMarkdownParserOptions } from 'vue-stream-markdown'
import { localFilePathFromHref } from '@/lib/path-ref'

/**
 * 本地图片在 markdown src 里的载体：harden 拦截 file:// 与裸路径，
 * 但放行 data:image/*。把本地引用编码进一个 data:image/svg+xml 标记，
 * 由 ResponseImage 组件解码后经 workspace:preview-file 换取真实内容。
 */
export const LOCAL_IMAGE_MARKER = 'data:image/svg+xml;charset=utf-8,zen-local-image:'

/** 反解标记 → 原始本地引用（file:// 已还原为路径）；非标记返回 null */
export function localPathFromMarker(src: string | undefined): string | null {
  if (!src?.startsWith(LOCAL_IMAGE_MARKER)) {
    return null
  }
  try {
    return decodeURIComponent(src.slice(LOCAL_IMAGE_MARKER.length))
  }
  catch {
    return null
  }
}

function localImageMarker(rawRef: string): string {
  return `${LOCAL_IMAGE_MARKER}${encodeURIComponent(rawRef)}`
}

export const responseParserOptions: StreamMarkdownParserOptions = {
  plugins: [{
    name: 'zen-local-file-links',
    markdownItPlugins: [(parser) => {
      const rules: unknown[] = parser.inline.ruler.getRules('')
      const linkRule = rules.find((rule): rule is (state: unknown, silent: boolean) => boolean =>
        typeof rule === 'function' && rule.name === 'link')
      const imageRule = rules.find((rule): rule is (state: unknown, silent: boolean) => boolean =>
        typeof rule === 'function' && rule.name === 'image')
      if (!linkRule) throw new Error('Markdown link rule is unavailable')
      // Scope normalization to links; file:// images retain the parser's rejection.
      parser.inline.ruler.at('link', (state: { src: string; pos: number }, silent: boolean) => {
        if (state.pos > 0 && state.src[state.pos - 1] === '!') return linkRule(state, silent)
        const normalizeLink = parser.normalizeLink
        parser.normalizeLink = (url: string) => {
          if (/^file:\/\//i.test(url)) {
            const path = localFilePathFromHref(url)
            // Keep percent escapes intact until ResponsePath resolves the href.
            if (path) return normalizeLink(new URL(url).pathname)
          }
          return normalizeLink(url)
        }
        try {
          return linkRule(state, silent)
        }
        finally {
          parser.normalizeLink = normalizeLink
        }
      })
      // 图片：本地路径 / file:// 改写为 data:image 标记，交给 ResponseImage 加载
      if (imageRule) {
        parser.inline.ruler.at('image', (state: unknown, silent: boolean) => {
          const normalizeLink = parser.normalizeLink
          parser.normalizeLink = (url: string) => {
            const path = localFilePathFromHref(url)
            return path ? localImageMarker(path) : normalizeLink(url)
          }
          try {
            return imageRule(state, silent)
          }
          finally {
            parser.normalizeLink = normalizeLink
          }
        })
      }
    }],
  }],
}
