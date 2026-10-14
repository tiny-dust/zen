<script setup lang="ts">
import type { HoverCardContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { OverlayElement } from '@/composables/useOverlayGeometry'
import { reactiveOmit } from '@vueuse/core'
import {
  HoverCardContent,
  HoverCardPortal,
  useForwardProps,
} from 'reka-ui'
import { ref } from 'vue'
import { useOverlayGeometry } from '@/composables/useOverlayGeometry'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<HoverCardContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    sideOffset: 4,
  },
)

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)

// 几何感知守卫：卡片与内嵌浏览器视图相交才压制原生 WebContentsView（见 useOverlayGeometry）
const contentEl = ref<OverlayElement>(null)
useOverlayGeometry(contentEl)
</script>

<template>
  <HoverCardPortal>
    <HoverCardContent
      ref="contentEl"
      data-slot="hover-card-content"
      v-bind="forwardedProps"
      :class="
        cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 rounded-md border p-4 shadow-md outline-hidden',
          props.class,
        )
      "
    >
      <slot />
    </HoverCardContent>
  </HoverCardPortal>
</template>
