<script setup lang="ts">
import { computed } from 'vue'

/**
 * 原生 range 滑杆的统一封装（样式走 styles.css 的 .slider-range）。
 * 项目约定：原生控件不直接在业务组件里使用，一律经由 ui/ 封装；
 * range 因依赖 ::-webkit-slider-thumb 伪元素样式，暂不换 reka Slider。
 */
const props = withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  modelValue?: number
  disabled?: boolean
  ariaLabel?: string
}>(), {
  min: 0,
  max: 100,
  step: 1,
  modelValue: 0,
  disabled: false,
  ariaLabel: undefined,
})

const emits = defineEmits<{
  (e: 'update:modelValue', payload: number): void
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v) => emits('update:modelValue', Number(v)),
})
</script>

<template>
  <input
    v-model="value"
    type="range"
    class="slider-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :aria-label="ariaLabel"
  >
</template>
