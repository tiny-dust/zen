<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useVModel } from '@vueuse/core'
import { computed, onUnmounted, provide, ref, watch } from 'vue'
import { ReasoningKey } from './context'

interface Props {
  class?: HTMLAttributes['class']
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  duration?: number
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  defaultOpen: true,
  duration: undefined,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:duration', value: number): void
}>()

const isOpen = useVModel(props, 'open', emit, {
  defaultValue: props.defaultOpen,
  passive: true,
})

const internalDuration = ref<number | undefined>(props.duration)

watch(() => props.duration, (newVal) => {
  internalDuration.value = newVal
})

function updateDuration(val: number) {
  internalDuration.value = val
  emit('update:duration', val)
}

const startTime = ref<number | null>(null)
const hasUserClosed = ref(false)
let autoCloseTimer: ReturnType<typeof setTimeout> | undefined

const MS_IN_S = 1000
const AUTO_CLOSE_DELAY = 1000

function clearAutoCloseTimer() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = undefined
  }
}

// A new stream may open reasoning once; a manual close remains respected for that cycle.
watch(() => props.isStreaming, (streaming, wasStreaming) => {
  clearAutoCloseTimer()
  if (streaming) {
    if (!wasStreaming) {
      hasUserClosed.value = false
      isOpen.value = true
    }
    if (startTime.value === null && props.duration === undefined) {
      startTime.value = Date.now()
    }
    return
  }

  if (startTime.value !== null) {
    const calculatedDuration = Math.ceil((Date.now() - startTime.value) / MS_IN_S)
    updateDuration(calculatedDuration)
    startTime.value = null
  }

  if (wasStreaming && isOpen.value && !hasUserClosed.value) {
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = undefined
      if (!props.isStreaming && !hasUserClosed.value) {
        isOpen.value = false
      }
    }, AUTO_CLOSE_DELAY)
  }
}, { immediate: true })

watch(isOpen, (open, wasOpen) => {
  if (wasOpen && !open && props.isStreaming) {
    hasUserClosed.value = true
  }
})

onUnmounted(clearAutoCloseTimer)

provide(ReasoningKey, {
  isStreaming: computed(() => props.isStreaming),
  isOpen,
  setIsOpen: (val: boolean) => { isOpen.value = val },
  duration: computed(() => internalDuration.value),
})
</script>

<template>
  <Collapsible
    v-model:open="isOpen"
    :class="cn('not-prose', props.class)"
  >
    <slot />
  </Collapsible>
</template>
