<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { AttachmentData } from './types'
import { cn } from '@/lib/utils'
import { computed, provide } from 'vue'
import { AttachmentKey, useAttachmentsContext } from './context'
import { getMediaCategory } from './utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  data: AttachmentData
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'remove'): void
}>()

const { variant } = useAttachmentsContext()
const data = computed(() => props.data)
const mediaCategory = computed(() => getMediaCategory(props.data))

function handleRemove() {
  emit('remove')
}

provide(AttachmentKey, {
  data,
  mediaCategory,
  remove: handleRemove,
  variant,
})
</script>

<template>
  <div
    :class="
      cn(
        'group relative',
        variant === 'grid' && 'size-24 overflow-hidden rounded-lg',
        variant === 'inline'
          && [
            'flex h-8 cursor-pointer select-none items-center gap-1.5',
            'text-sm',
          ],
        variant === 'list'
          && [
            'flex w-full items-center gap-3 rounded-lg border p-3',
            'hover:bg-accent/50',
          ],
        props.class,
      )
    "
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>
