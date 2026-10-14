<script setup lang="ts">
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { OverlayElement } from '@/composables/useOverlayGeometry'
import { reactiveOmit } from '@vueuse/core'
import {
  PopoverContent,
  PopoverPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { ref } from 'vue'
import { useOverlayGeometry } from '@/composables/useOverlayGeometry'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'center',
    sideOffset: 4,
  },
)
const emits = defineEmits<PopoverContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// 几何感知守卫：弹层与内嵌浏览器视图相交才压制原生 WebContentsView（见 useOverlayGeometry）
const contentEl = ref<OverlayElement>(null)
useOverlayGeometry(contentEl)
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      ref="contentEl"
      data-slot="popover-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 flex flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 duration-100 z-50 w-72 max-w-(--reka-popover-content-available-width) origin-(--reka-popover-content-transform-origin) outline-hidden',
          props.class,
        )
      "
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
