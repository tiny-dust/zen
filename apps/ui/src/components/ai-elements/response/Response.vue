<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, useSlots } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import FilePathRenderer from './ResponsePath.vue'
import ResponseImage from './ResponseImage.vue'
import { responseParserOptions } from './local-file-links'
import { codeThemeId, compactCodeOptions, streamMarkdownExtensions } from '@/components/ai-elements/response/extensions'
import { useAppTheme } from '@/composables/useAppTheme'
import { cn } from '@/lib/utils'
import 'vue-stream-markdown/index.css'

interface Props {
  content?: string
  /** Keep streaming text visible immediately; animation is opt-in. */
  enableAnimate?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  enableAnimate: false,
})

const slots = useSlots()
const slotContent = computed<string | undefined>(() => {
  const nodes = slots.default?.()
  if (!Array.isArray(nodes)) {
    return undefined
  }
  let text = ''
  for (const node of nodes) {
    if (typeof node.children === 'string') {
      text += node.children
    }
  }
  return text || undefined
})

const md = computed(() => (slotContent.value ?? props.content ?? '') as string)

// 代码高亮深浅跟随应用主题（原为写死 true，亮色主题下代码块观感错误）
const { isDark } = useAppTheme()
</script>

<template>
  <Markdown
    :key="codeThemeId"
    :content="md"
    :enable-animate="props.enableAnimate"
    :extensions="streamMarkdownExtensions"
    :code-options="compactCodeOptions"
    :is-dark="isDark"
    :components="{ code: FilePathRenderer, a: FilePathRenderer }"
    :ui-components="{ Image: ResponseImage }"
    :parser-options="responseParserOptions"
    :class="cn('w-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!', props.class)"
    v-bind="$attrs"
  />
</template>
