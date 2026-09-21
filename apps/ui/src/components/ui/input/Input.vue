<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { InputVariants } from '.'
import { useVModel } from '@vueuse/core'
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { inputVariants } from '.'

const props = withDefaults(defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  /** default：带边框表单输入；ghost：无边框透明，用于浮层搜索、行内编辑等场景 */
  variant?: InputVariants['variant']
  class?: HTMLAttributes['class']
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

const inputEl = ref<HTMLInputElement | null>(null)

defineExpose({
  focus: () => inputEl.value?.focus(),
  blur: () => inputEl.value?.blur(),
  select: () => inputEl.value?.select(),
})
</script>

<template>
  <input
    ref="inputEl"
    v-model="modelValue"
    data-slot="input"
    :class="cn(inputVariants({ variant }), props.class)"
  >
</template>
