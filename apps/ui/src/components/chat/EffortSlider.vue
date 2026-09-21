<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { SliderRange } from "@/components/ui/slider";

import { REASONING_EFFORTS } from "@zen/shared";

import type { ReasoningEffort } from "@zen/shared";

const props = defineProps<{
  modelValue: ReasoningEffort;
  allowed?: readonly ReasoningEffort[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ReasoningEffort];
}>();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const steps = computed(() => {
  // 模型声明了推理档位时，直接展示配置的档位（不含「关闭」）
  if (props.allowed?.length) {
    return [...props.allowed];
  }
  return ["off" as ReasoningEffort, ...REASONING_EFFORTS.filter((item) => item.id !== "off").map((item) => item.id)];
});

const index = computed(() => {
  const i = steps.value.indexOf(props.modelValue);
  return i >= 0 ? i : steps.value.length ? Math.floor(steps.value.length / 2) : 0;
});

const label = computed(() => {
  const id = steps.value[index.value] ?? "off";
  return REASONING_EFFORTS.find((item) => item.id === id)?.label ?? "关闭";
});

const sliderMax = computed(() => Math.max(steps.value.length - 1, 0));

/** 信号条动态填充：按当前档位在可选档位中的占比点亮 1–3 格（MiMo 同构） */
const filledBars = computed(() => {
  if (steps.value.length <= 1) {
    return 0;
  }
  return Math.min(3, Math.max(1, Math.ceil(((index.value + 1) / steps.value.length) * 3)));
});

function onInput(next: number) {
  const id = steps.value[next];
  if (id) {
    emit("update:modelValue", id);
  }
}

function toggle() {
  if (steps.value.length <= 1) {
    return;
  }
  open.value = !open.value;
}

function onDocClick(event: MouseEvent) {
  const el = rootEl.value;
  if (el && !el.contains(event.target as Node)) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootEl" class="relative">
    <Button
      variant="ghost"
      class="h-auto min-h-8 gap-1.5 px-1.5 font-normal text-[12px] md:text-[12px] text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)] aria-expanded:bg-transparent aria-expanded:text-[var(--color-txt-strong)] disabled:cursor-not-allowed disabled:opacity-55"
      :disabled="steps.length <= 1"
      :aria-expanded="open"
      aria-label="思考强度"
      @click="toggle"
    >
      <span class="inline-flex h-3 items-end gap-0.5" aria-hidden="true">
        <i
          class="block h-[5px] w-[2.5px] rounded-[1px]"
          :class="filledBars >= 1 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'"
        />
        <i
          class="block h-2 w-[2.5px] rounded-[1px]"
          :class="filledBars >= 2 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'"
        />
        <i
          class="block h-[11px] w-[2.5px] rounded-[1px]"
          :class="filledBars >= 3 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'"
        />
      </span>
      <span>{{ label }}</span>
    </Button>

    <div
      v-if="open"
      class="absolute bottom-[calc(100%+10px)] left-1/2 z-[var(--z-popup)] w-[220px] -translate-x-1/2 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] px-3.5 pt-3 pb-2.5 shadow-[var(--shadow-menu)]"
      role="dialog"
      aria-label="思考强度"
    >
      <div class="mb-2.5 flex items-center justify-between">
        <span class="text-[12.5px] font-semibold text-[var(--color-txt-strong)]">思考强度</span>
        <span class="text-[12.5px] font-semibold text-[var(--color-accent)]">{{ label }}</span>
      </div>
      <SliderRange
        :model-value="index"
        :min="0"
        :max="sliderMax"
        :step="1"
        aria-label="思考强度"
        :aria-valuetext="label"
        @update:model-value="onInput"
      />
      <div class="mt-1.5 flex justify-between text-[10px] text-[var(--color-dim)]">
        <span v-for="id in steps" :key="id">
          {{ REASONING_EFFORTS.find((item) => item.id === id)?.label ?? id }}
        </span>
      </div>
    </div>
  </div>
</template>
