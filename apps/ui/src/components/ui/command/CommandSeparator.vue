<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div
    data-slot="command-separator"
    role="separator"
    :class="cn('my-1 h-px shrink-0 bg-[var(--color-line)]', props.class)"
  />
</template>
