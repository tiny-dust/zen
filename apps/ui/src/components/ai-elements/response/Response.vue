<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed, useSlots } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import { streamMarkdownExtensions } from '@/components/ai-elements/response/extensions'
import 'vue-stream-markdown/index.css'

interface Props {
  content?: string
  /** 流式逐段淡入动画：新文本在动画前不可见（backwards 填充），快速输出时
   * 尾部会长时间空白看不到实时内容，默认关闭保证内容随到随显 */
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
    if (typeof node.children === 'string')
      text += node.children
  }
  return text || undefined
})

const md = computed(() => (slotContent.value ?? props.content ?? '') as string)
</script>

<template>
  <Markdown
    :content="md"
    :enable-animate="props.enableAnimate"
    :extensions="streamMarkdownExtensions"
    :is-dark="true"
    :class="
      cn(
        'w-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
        props.class,
      )
    "
    v-bind="$attrs"
  />
</template>
