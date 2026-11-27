<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxItem, useForwardPropsEmits } from 'reka-ui'
import { computed, onBeforeUnmount, watch } from 'vue'
import { cn } from '@/lib/utils'
import { matchesSearch } from './filter'
import { injectCommand } from './injection'

const props = defineProps<
  ListboxItemProps & { keywords?: string[]; class?: HTMLAttributes['class'] }
>()
const emits = defineEmits<ListboxItemEmits>()

const command = injectCommand()
const matched = computed(() =>
  matchesSearch(String(props.value ?? ''), props.keywords, command.search.value),
)

// 过滤掉即卸载：Collection 的键盘导航会自动跳过不可见项，CommandEmpty 也据此计数
watch(
  matched,
  (visible) => {
    command.visibleCount.value += visible ? 1 : -1
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (matched.value) {
    command.visibleCount.value -= 1
  }
})

const delegatedProps = reactiveOmit(props, 'class', 'keywords')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ListboxItem
    v-if="matched"
    data-slot="command-item"
    v-bind="forwarded"
    :class="
      cn(
        'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-[var(--color-txt)] select-none data-[highlighted]:bg-[var(--color-menu-hover)] data-[highlighted]:text-[var(--color-txt-strong)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg:not([class*=size-])]:size-3.5 [&_svg]:shrink-0',
        props.class,
      )
    "
  >
    <slot />
  </ListboxItem>
</template>
