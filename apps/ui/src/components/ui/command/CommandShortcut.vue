<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <span
    data-slot="command-shortcut"
    :class="
      cn(
        'ml-auto font-[family-name:var(--font-mono)] text-[11px] tracking-widest text-[var(--color-dim)]',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
