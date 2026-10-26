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
  /**
   * 内容仍在流式输出中。渲染器默认 mode=streaming，会把最后一个块节点标记为
   * 「未闭合」并在表格/代码块下方显示加载转圈；消息结束后必须切 static，
   * 否则末尾是表格的回复会永久留一个转圈。
   */
  streaming?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  enableAnimate: false,
  streaming: false,
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
    :mode="props.streaming ? 'streaming' : 'static'"
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
