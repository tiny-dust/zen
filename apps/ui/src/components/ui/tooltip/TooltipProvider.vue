<script setup lang="ts">
import type { TooltipProviderProps } from 'reka-ui'
import { TooltipProvider } from 'reka-ui'

withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 200,
})
</script>

<template>
  <TooltipProvider v-bind="$props" data-slot="tooltip-provider">
    <slot />
  </TooltipProvider>
</template>
