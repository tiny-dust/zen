<script setup lang="ts">
import { ContextMenuRoot, type ContextMenuRootEmits, type ContextMenuRootProps } from 'reka-ui'

const props = defineProps<ContextMenuRootProps>()
const emits = defineEmits<ContextMenuRootEmits>()
</script>

<template>
  <ContextMenuRoot
    data-slot="context-menu"
    v-bind="props"
    @update:open="emits('update:open', $event)"
  >
    <slot />
  </ContextMenuRoot>
</template>
