<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { OverlayElement } from '@/composables/useOverlayGeometry'
import { reactiveOmit } from '@vueuse/core'
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import { useOverlayGeometry } from '@/composables/useOverlayGeometry'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    sideOffset: 4,
  },
)
const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)

// 几何感知守卫：tooltip 与内嵌浏览器视图相交才压制原生 WebContentsView
const contentEl = ref<OverlayElement>(null)
useOverlayGeometry(contentEl)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      ref="contentEl"
      data-slot="tooltip-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'bg-popover text-popover-foreground shadow-tip ring-foreground/10 z-50 w-fit max-w-72 origin-(--reka-tooltip-content-transform-origin) rounded-md px-2 py-1 text-[11px] leading-snug ring-1',
          'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 duration-100',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
          props.class,
        )
      "
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
