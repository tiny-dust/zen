<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import type { OverlayElement } from '@/composables/useOverlayGeometry'
import { XIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { ref } from 'vue'
import { useOverlayGeometry } from '@/composables/useOverlayGeometry'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// 几何感知守卫：弹窗与内嵌浏览器视图相交才压制原生 WebContentsView（见 useOverlayGeometry）
const contentEl = ref<OverlayElement>(null)
useOverlayGeometry(contentEl)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-[var(--z-overlay)] grid place-items-center overflow-y-auto bg-[var(--color-scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    >
      <DialogContent
        ref="contentEl"
        :class="
          cn(
            'relative z-50 grid w-full max-w-lg my-8 gap-4 border border-border bg-background p-6 shadow-lg duration-200 sm:rounded-lg md:w-full',
            props.class,
          )
        "
        v-bind="{ ...$attrs, ...forwarded }"
        @pointer-down-outside="(event) => {
          const originalEvent = event.detail.originalEvent;
          const target = originalEvent.target as HTMLElement;
          if (originalEvent.offsetX > target.clientWidth || originalEvent.offsetY > target.clientHeight) {
            event.preventDefault();
          }
        }"
      >
        <slot />

        <DialogClose
          class="absolute top-4 right-4 p-0.5 transition-colors rounded-md hover:bg-secondary"
        >
          <XIcon class="w-4 h-4" />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>
