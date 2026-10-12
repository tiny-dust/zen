<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { BrainIcon, ChevronDownIcon } from '@lucide/vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useReasoningContext } from './context'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { t } = useI18n()

const { isStreaming, isOpen, duration } = useReasoningContext()

const thinkingMessage = computed(() => {
  if (isStreaming.value) {
    return 'thinking'
  }
  if (duration.value === undefined) {
    return 'default_done'
  }
  return 'duration_done'
})
</script>

<template>
  <CollapsibleTrigger
    :class="cn(
      'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
      props.class,
    )"
  >
    <slot>
      <BrainIcon class="size-4" />

      <template v-if="thinkingMessage === 'thinking'">
        <span class="animate-pulse">{{ t("chat.reasoning.thinking") }}</span>
      </template>

      <template v-else-if="thinkingMessage === 'default_done'">
        <span>{{ t("chat.reasoning.done") }}</span>
      </template>

      <template v-else>
        <span>{{ t("chat.reasoning.thoughtFor", { n: duration }) }}</span>
      </template>

      <ChevronDownIcon
        :class="cn(
          'size-4 transition-transform',
          isOpen ? 'rotate-180' : 'rotate-0',
        )"
      />
    </slot>
  </CollapsibleTrigger>
</template>
