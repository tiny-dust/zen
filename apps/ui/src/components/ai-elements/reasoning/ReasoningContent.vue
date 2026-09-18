<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { computed, useSlots } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import { streamMarkdownExtensions } from '@/components/ai-elements/response/extensions'
import 'vue-stream-markdown/index.css'

interface Props {
  class?: HTMLAttributes['class']
  content: string
}

const props = defineProps<Props>()
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
  <CollapsibleContent
    :class="cn(
      'reasoning-dim mt-3 text-[13px] leading-[1.8] text-muted-foreground',
      'border-l border-[var(--color-line)] pl-3',
      'outline-none',
      props.class,
    )"
  >
    <!-- 同 Response：关闭流式逐段动画；思考文本用独立弱色（styles.css 的 .reasoning-dim 覆盖库的根节点前景色） -->
    <Markdown
      :content="md"
      :enable-animate="false"
      :extensions="streamMarkdownExtensions"
      :is-dark="true"
    />
  </CollapsibleContent>
</template>
