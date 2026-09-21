<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { TextareaVariants } from '.'
import { useVModel } from '@vueuse/core'
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { textareaVariants } from '.'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  defaultValue?: string | number
  modelValue?: string | number
  /** default：带边框表单输入；ghost：无边框透明，用于内嵌面板、行内编辑等场景 */
  variant?: TextareaVariants['variant']
}>(), {
  variant: 'default',
})

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const textareaEl = ref<HTMLTextAreaElement | null>(null)

defineExpose({
  focus: () => textareaEl.value?.focus(),
  blur: () => textareaEl.value?.blur(),
  select: () => textareaEl.value?.select(),
})
</script>

<template>
  <textarea
    ref="textareaEl"
    v-model="modelValue"
    data-slot="textarea"
    :class="cn(textareaVariants({ variant }), props.class)"
  />
</template>
