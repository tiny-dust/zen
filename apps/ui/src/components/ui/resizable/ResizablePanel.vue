<script setup lang="ts">
import type { SplitterPanelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SplitterPanel } from 'reka-ui'
import { ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<SplitterPanelProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

/** 折叠/展开/尺寸由外部状态驱动（配合 size-unit="px" 直接收像素值） */
const panel = ref<{
  collapse: () => void
  expand: () => void
  resize: (size: number) => void
} | null>(null)

defineExpose({
  collapse: () => panel.value?.collapse(),
  expand: () => panel.value?.expand(),
  resize: (size: number) => panel.value?.resize(size),
})
</script>

<template>
  <SplitterPanel
    ref="panel"
    data-slot="resizable-panel"
    v-bind="delegatedProps"
    :class="cn('flex min-h-0 min-w-0 flex-col', props.class)"
  >
    <slot />
  </SplitterPanel>
</template>
