<script setup lang="ts">
import { computed } from "vue";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * 时刻选择字段：shadcn-vue 无独立 time 组件，按官方模式用时/分双 Select 组合。
 * 模型为 "HH:mm" 字符串，与计划任务表单的既有格式一致。
 */
const props = defineProps<{
  modelValue: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/** "HH:mm" → { hour, minute }；缺省回落 08:30，容错 "9:5" 这类单数位写法 */
const parts = computed(() => {
  const [rawHour = "08", rawMinute = "30"] = props.modelValue.split(":");
  return {
    hour: rawHour.padStart(2, "0").slice(0, 2),
    minute: rawMinute.padStart(2, "0").slice(0, 2),
  };
});

function setHour(value: unknown): void {
  if (typeof value !== "string" || !value) {
    return;
  }
  emit("update:modelValue", `${value}:${parts.value.minute}`);
}

function setMinute(value: unknown): void {
  if (typeof value !== "string" || !value) {
    return;
  }
  emit("update:modelValue", `${parts.value.hour}:${value}`);
}
</script>

<template>
  <div role="group" :aria-label="ariaLabel" class="grid grid-cols-2 gap-2">
    <Select
      :model-value="parts.hour"
      @update:model-value="(value) => setHour(value)"
    >
      <SelectTrigger class="h-8 w-full text-[12px]" :aria-label="`${ariaLabel}（时）`">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="hour in HOURS" :key="hour" :value="hour">{{ hour }}</SelectItem>
      </SelectContent>
    </Select>
    <Select
      :model-value="parts.minute"
      @update:model-value="(value) => setMinute(value)"
    >
      <SelectTrigger class="h-8 w-full text-[12px]" :aria-label="`${ariaLabel}（分）`">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="minute in MINUTES" :key="minute" :value="minute">{{ minute }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
