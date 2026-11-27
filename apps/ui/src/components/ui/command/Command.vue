<script setup lang="ts">
import type { ListboxRootEmits, ListboxRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxRoot, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { provideCommand } from './injection'

/**
 * 命令面板根节点。reka 的 Listbox 不自带过滤，这里把过滤词与「当前可见条目数」
 * 下发给 CommandInput / CommandItem / CommandEmpty：被过滤掉的条目会被卸载，
 * 键盘上下（Collection 驱动）也就不会停在不可见项上。
 */
const props = defineProps<ListboxRootProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ListboxRootEmits>()

const search = ref('')
const visibleCount = ref(0)
provideCommand({ search, visibleCount })

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ListboxRoot
    data-slot="command"
    v-bind="forwarded"
    :class="
      cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        props.class,
      )
    "
  >
    <slot />
  </ListboxRoot>
</template>
