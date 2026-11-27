<script setup lang="ts">
import type { SplitterResizeHandleEmits, SplitterResizeHandleProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SplitterResizeHandle, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<
  SplitterResizeHandleProps & { class?: HTMLAttributes['class'] }
>()
const emits = defineEmits<SplitterResizeHandleEmits>()

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <!-- 9px 真实命中区 + 居中 1px 发丝线：线本身仍是 1px，鼠标可抓取的范围够宽；
       悬停/拖拽/键盘聚焦只把发丝线换成强调色（不做粗圈，见 UI_STYLE 第 3 节第 7 条） -->
  <SplitterResizeHandle
    data-slot="resizable-handle"
    v-bind="forwarded"
    :class="
      cn(
        'group relative flex shrink-0 touch-none items-center justify-center bg-transparent outline-none',
        'after:absolute after:bg-[var(--color-line)] after:transition-colors after:duration-[var(--motion-fast)] after:ease-[var(--ease-enter)]',
        'data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-[9px] data-[orientation=horizontal]:cursor-col-resize',
        'data-[orientation=horizontal]:after:inset-y-0 data-[orientation=horizontal]:after:left-1/2 data-[orientation=horizontal]:after:w-px data-[orientation=horizontal]:after:-translate-x-1/2',
        'data-[orientation=vertical]:h-[9px] data-[orientation=vertical]:w-full data-[orientation=vertical]:cursor-row-resize',
        'data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:top-1/2 data-[orientation=vertical]:after:h-px data-[orientation=vertical]:after:-translate-y-1/2',
        'data-[resize-handle-state=hover]:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]',
        'data-[resize-handle-state=drag]:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]',
        'data-[resize-handle-active=keyboard]:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]',
        props.class,
      )
    "
  >
    <slot />
  </SplitterResizeHandle>
</template>
