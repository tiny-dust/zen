<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="bento-grid"
    :class="cn('grid grid-cols-12 gap-4', props.class)"
  >
    <slot />
  </div>
</template>
