<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const bentoCardVariants = cva(
  'pressable lift rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-set-card)] p-4 text-left transition-all',
  {
    variants: {
      span: {
        '12': 'col-span-12',
        '6': 'col-span-12 sm:col-span-6',
        '4': 'col-span-12 sm:col-span-6 lg:col-span-4',
        '8': 'col-span-12 lg:col-span-8',
      },
    },
    defaultVariants: {
      span: '12',
    },
  },
)

type BentoCardSpan = NonNullable<VariantProps<typeof bentoCardVariants>['span']>

const props = withDefaults(defineProps<{
  /** 根元素标签：可点击的预览卡传 button（配合 type="button"），默认 div */
  as?: 'div' | 'button'
  class?: HTMLAttributes['class']
  /** 栅格跨度（BentoGrid 为 12 列网格） */
  span?: BentoCardSpan
}>(), {
  as: 'div',
  span: '12',
})
</script>

<template>
  <component
    :is="as"
    data-slot="bento-card"
    :class="cn(bentoCardVariants({ span }), props.class)"
  >
    <slot />
  </component>
</template>
