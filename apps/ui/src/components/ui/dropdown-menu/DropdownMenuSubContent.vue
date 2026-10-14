<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { OverlayElement } from '@/composables/useOverlayGeometry'
import { reactiveOmit } from '@vueuse/core'
import {
  DropdownMenuSubContent,
  useForwardPropsEmits,
} from 'reka-ui'
import { ref } from 'vue'
import { useOverlayGeometry } from '@/composables/useOverlayGeometry'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DropdownMenuSubContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// 几何感知守卫：子菜单与内嵌浏览器视图相交才压制原生 WebContentsView（见 useOverlayGeometry）
const contentEl = ref<OverlayElement>(null)
useOverlayGeometry(contentEl)
</script>

<template>
  <DropdownMenuSubContent
    ref="contentEl"
    data-slot="dropdown-menu-sub-content"
    v-bind="forwarded"
    :class="cn('data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 bg-popover text-popover-foreground min-w-[96px] rounded-lg p-1 shadow-lg ring-1 duration-100 cn-menu-translucent z-50 max-w-(--reka-dropdown-menu-content-available-width) origin-(--reka-dropdown-menu-content-transform-origin) overflow-hidden', props.class)"
  >
    <slot />
  </DropdownMenuSubContent>
</template>
