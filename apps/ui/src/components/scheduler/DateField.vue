<script setup lang="ts">
import { CalendarDate, DateFormatter, getLocalTimeZone, parseDate, today } from "@internationalized/date";

import type { DateValue } from "@internationalized/date";
import { CalendarIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * 日期选择字段：shadcn-vue date-picker 组合（Popover + Calendar month-and-year）。
 * 模型为本地时区 "YYYY-MM-DD" 字符串，与计划任务表单的既有格式一致。
 */
const props = defineProps<{
  /** "YYYY-MM-DD"，空串表示未选择 */
  modelValue: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { locale, t } = useI18n();

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateValue = computed<CalendarDate | undefined>(() =>
  ISO_RE.test(props.modelValue) ? parseDate(props.modelValue) : undefined,
);

const df = computed(() => new DateFormatter(locale.value, { dateStyle: "long" }));

const label = computed(() =>
  dateValue.value ? df.value.format(dateValue.value.toDate(getLocalTimeZone())) : t("scheduler.pickDate"),
);

/** Calendar 选中即回写并收起浮层（CalendarDateTime 等带时间的值截取日期部分） */
function onSelect(value: DateValue | undefined, close: () => void): void {
  if (!value) {
    return;
  }
  emit("update:modelValue", value.toString().slice(0, 10));
  close();
}
</script>

<template>
  <Popover v-slot="{ close }">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="h-8 w-full justify-start px-2.5 text-[12px] font-normal"
        :class="!dateValue && 'text-[var(--color-mut)]'"
        :aria-label="ariaLabel"
      >
        <CalendarIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ label }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar
        :model-value="dateValue"
        :locale="locale"
        :default-placeholder="today(getLocalTimeZone())"
        layout="month-and-year"
        initial-focus
        @update:model-value="(value: DateValue | undefined) => onSelect(value, close)"
      />
    </PopoverContent>
  </Popover>
</template>
