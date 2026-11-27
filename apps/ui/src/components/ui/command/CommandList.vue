<script setup lang="ts">
import type { ListboxContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<ListboxContentProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <ListboxContent
    data-slot="command-list"
    v-bind="delegatedProps"
    :class="
      cn(
        'min-h-0 flex-1 scroll-py-1 overflow-x-hidden overflow-y-auto p-1 outline-none',
        props.class,
      )
    "
  >
    <slot />
  </ListboxContent>
</template>
