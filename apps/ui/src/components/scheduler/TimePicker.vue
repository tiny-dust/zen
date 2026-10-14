<script setup lang="ts">
import { ClockIcon } from "@lucide/vue";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 时刻选择器：shadcn-vue 无独立 time 组件，官方模式为时/分选择组合；
 * 这里收进单个 Popover 触发器（与 DateField 同构），模型为 "HH:mm" 字符串。
 */
const props = defineProps<{
  modelValue: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const HHMM_RE = /^(\d{1,2}):(\d{1,2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const hourValue = computed(() => {
  const match = HHMM_RE.exec(props.modelValue);
  return match ? pad2(Number(match[1])) : "09";
});

const minuteValue = computed(() => {
  const match = HHMM_RE.exec(props.modelValue);
  return match ? pad2(Number(match[2])) : "00";
});

function setHour(value: unknown): void {
  emit("update:modelValue", `${String(value)}:${minuteValue.value}`);
}

function setMinute(value: unknown): void {
  emit("update:modelValue", `${hourValue.value}:${String(value)}`);
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="h-8 w-full justify-start px-2.5 text-[12px] font-normal tabular-nums"
        :aria-label="ariaLabel"
      >
        <ClockIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{{ hourValue }}:{{ minuteValue }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-3" align="start">
      <div class="flex items-center gap-2">
        <Select :model-value="hourValue" @update:model-value="setHour">
          <SelectTrigger class="h-8 w-[64px] text-[12px] tabular-nums" :aria-label="`${ariaLabel} hour`">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="hour in 24" :key="hour" :value="pad2(hour - 1)">
              {{ pad2(hour - 1) }}
            </SelectItem>
          </SelectContent>
        </Select>
        <span class="text-[12px] text-[var(--color-mut)]" aria-hidden="true">:</span>
        <Select :model-value="minuteValue" @update:model-value="setMinute">
          <SelectTrigger class="h-8 w-[64px] text-[12px] tabular-nums" :aria-label="`${ariaLabel} minute`">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="minute in 60" :key="minute" :value="pad2(minute - 1)">
              {{ pad2(minute - 1) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </PopoverContent>
  </Popover>
</template>
