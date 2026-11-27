<script setup lang="ts">
import type { ListboxFilterProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Search } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxFilter } from 'reka-ui'
import { cn } from '@/lib/utils'
import { injectCommand } from './injection'

const props = defineProps<
  Omit<ListboxFilterProps, 'modelValue'> & {
    placeholder?: string
    class?: HTMLAttributes['class']
  }
>()

const { search } = injectCommand()

const delegatedProps = reactiveOmit(props, 'class', 'placeholder')
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-2.5"
  >
    <Search class="size-3.5 shrink-0 text-[var(--color-dim)]" aria-hidden="true" />
    <ListboxFilter
      v-model="search"
      data-slot="command-input"
      v-bind="delegatedProps"
      :placeholder="props.placeholder"
      :class="
        cn(
          'h-full w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-dim)] disabled:cursor-not-allowed disabled:opacity-50',
          props.class,
        )
      "
    />
  </div>
</template>
