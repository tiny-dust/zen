import type { StreamMarkdownParserOptions } from 'vue-stream-markdown'
import { localFilePathFromHref } from '@/lib/path-ref'

export const responseParserOptions: StreamMarkdownParserOptions = {
  plugins: [{
    name: 'zen-local-file-links',
    markdownItPlugins: [(parser) => {
      const rules: unknown[] = parser.inline.ruler.getRules('')
      const linkRule = rules.find((rule): rule is (state: unknown, silent: boolean) => boolean =>
        typeof rule === 'function' && rule.name === 'link')
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
    }],
  }],
}
