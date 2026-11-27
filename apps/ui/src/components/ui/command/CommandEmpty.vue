<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { injectCommand } from './injection'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const command = injectCommand()
const empty = computed(() => command.visibleCount.value === 0)
</script>

<template>
  <div
    v-if="empty"
    data-slot="command-empty"
    :class="cn('py-6 text-center text-[13px] text-[var(--color-dim)]', props.class)"
  >
    <slot />
  </div>
</template>
