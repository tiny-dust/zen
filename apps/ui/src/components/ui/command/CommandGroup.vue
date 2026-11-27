<script setup lang="ts">
import type { ListboxGroupProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxGroup, ListboxGroupLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<
  ListboxGroupProps & { heading?: string; class?: HTMLAttributes['class'] }
>()

const delegatedProps = reactiveOmit(props, 'class', 'heading')
</script>

<template>
  <ListboxGroup
    data-slot="command-group"
    v-bind="delegatedProps"
    :class="cn('overflow-hidden', props.class)"
  >
    <ListboxGroupLabel
      v-if="heading"
      data-slot="command-group-heading"
      class="px-2 pt-2 pb-1 text-[11px] text-[var(--color-dim)]"
    >
      {{ heading }}
    </ListboxGroupLabel>
    <slot />
  </ListboxGroup>
</template>
