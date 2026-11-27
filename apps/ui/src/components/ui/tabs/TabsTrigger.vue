<script setup lang="ts">
import type { TabsTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <!-- 选中态只加 1px 下划线 + 文字提亮，不做粗圈或实底 -->
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="delegatedProps"
    :class="
      cn(
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 px-2 text-[13px] whitespace-nowrap transition-colors outline-none',
        'text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]',
        'data-[state=active]:text-[var(--color-txt-strong)]',
        'data-[state=active]:after:absolute data-[state=active]:after:inset-x-1 data-[state=active]:after:-bottom-px data-[state=active]:after:h-px data-[state=active]:after:bg-[var(--color-accent)]',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*=size-])]:size-3.5',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
