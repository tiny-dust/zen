<script setup lang="ts">
import { CalendarDate, parseDate, today, getLocalTimeZone } from "@internationalized/date";

import type { CalendarDate as CalendarDateValue } from "@internationalized/date";
import type { DateValue } from "reka-ui";
import type { MonthlyPattern, ScheduledTaskSchedule, ScheduleUnit } from "@zen/shared";
import { matchesDate, nextOccurrences } from "@zen/shared";
import { CalendarClock, Plus, X } from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import DateField from "./DateField.vue";
import TimePicker from "./TimePicker.vue";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 统一调度编辑器（Calendar/DatePicker 中心）：
 * - 重复（recurrence）：每 N 秒/分/时/天/周/月；周→星期几多选，月→几号或第 N 个周几；
 *   天/周/月支持一天多个时刻与截止日期，并配日历高亮 + 下次运行预览
 * - 每日时间范围（window）/ 单次（once）/ 指定日期（dates，日历多选）
 * 旧类型任务（interval/daily/monthly）导入时前向迁移到「重复」。
 * 编辑器每次状态变化向外发草稿 schedule；validate() 供提交前校验。
 */

type EditorMode = "recurrence" | "window" | "once" | "dates";

const props = defineProps<{
  /** 草稿调度（可能不完整；由 validate() 在提交前把关） */
  modelValue: ScheduledTaskSchedule;
}>();

const emit = defineEmits<{ "update:modelValue": [value: ScheduledTaskSchedule] }>();

const { locale, t } = useI18n();

const MODES: EditorMode[] = ["recurrence", "window", "once", "dates"];
const MODE_KEYS: Record<EditorMode, string> = {
  recurrence: "scheduler.scheduleRecurrence",
  window: "scheduler.scheduleWindow",
  once: "scheduler.scheduleOnce",
  dates: "scheduler.scheduleDates",
};

const UNIT_KEYS: Record<ScheduleUnit, string> = {
  second: "scheduler.unitSecond",
  minute: "scheduler.unitMinute",
  hour: "scheduler.unitHour",
  day: "scheduler.unitDay",
  week: "scheduler.unitWeek",
  month: "scheduler.unitMonth",
};

/** recurrence 单位下拉（秒/分/时为全天循环；天/周/月按日历挑日子） */
const UNITS: ScheduleUnit[] = ["second", "minute", "hour", "day", "week", "month"];
/** 按日历挑日子的单位（需要时刻列表/日历预览） */
const TIMED_UNITS: ScheduleUnit[] = ["day", "week", "month"];

/** 星期几 0=周日 … 6=周六（与 shared weekdays 约定一致） */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地时区日期的 YYYY-MM-DD */
function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 一天后的日期（once/until 的合理默认） */
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateISO(d);
}

/** 30 天后（until 的合理默认） */
function monthLaterISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return localDateISO(d);
}

const state = reactive({
  mode: "recurrence" as EditorMode,
  every: 1,
  unit: "day" as ScheduleUnit,
  weekdays: [1, 2, 3, 4, 5] as number[],
  monthlyMode: "day" as "day" | "nthWeekday",
  monthlyDay: 1,
  monthlyNth: 2,
  monthlyWeekday: 2,
  times: ["09:00"] as string[],
  untilEnabled: false,
  until: monthLaterISO(),
  windowStart: "09:00",
  windowEnd: "18:00",
  everyMinutes: 30,
  onceDate: tomorrowISO(),
  onceTime: "09:00",
  dates: [] as string[],
});

/** 外部 schedule → 编辑器状态（新建/切换编辑任务时；旧类型前向迁移） */
function importSchedule(schedule: ScheduledTaskSchedule): void {
  state.untilEnabled = false;
  state.dates = [];
  switch (schedule.kind) {
    case "recurrence":
      state.mode = "recurrence";
      state.every = schedule.every ?? 1;
      state.unit = schedule.unit ?? "day";
      state.weekdays = schedule.weekdays?.length ? [...schedule.weekdays] : [1, 2, 3, 4, 5];
      state.times = schedule.times?.length ? [...schedule.times] : ["09:00"];
      state.untilEnabled = schedule.until !== undefined;
      state.until = schedule.until ?? monthLaterISO();
      state.monthlyMode = schedule.monthlyOn?.mode ?? "day";
      state.monthlyDay = schedule.monthlyOn?.mode === "day" ? schedule.monthlyOn.day : 1;
      state.monthlyNth = schedule.monthlyOn?.mode === "nthWeekday" ? schedule.monthlyOn.nth : 2;
      state.monthlyWeekday = schedule.monthlyOn?.mode === "nthWeekday" ? schedule.monthlyOn.weekday : 2;
      break;
    case "dates":
      state.mode = "dates";
      state.dates = [...(schedule.dates ?? [])];
      state.times = schedule.times?.length ? [...schedule.times] : ["09:00"];
      break;
    case "window":
      state.mode = "window";
      state.windowStart = schedule.startTime ?? "09:00";
      state.windowEnd = schedule.endTime ?? "18:00";
      state.everyMinutes = schedule.everyMinutes ?? 30;
      break;
    case "once": {
      state.mode = "once";
      const d = Number.isFinite(schedule.at) ? new Date(schedule.at ?? 0) : new Date();
      state.onceDate = localDateISO(d);
      state.onceTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      break;
    }
    case "interval":
      // 旧间隔循环 → 重复（同单位同间隔）
      state.mode = "recurrence";
      state.every = schedule.every ?? 30;
      state.unit = schedule.unit ?? "minute";
      state.times = ["09:00"];
      break;
    case "daily":
      // 旧每日定时 → 每 1 天 × 时刻
      state.mode = "recurrence";
      state.every = 1;
      state.unit = "day";
      state.times = [schedule.time ?? "08:30"];
      break;
    case "monthly":
      // 旧每月几号 → 每 1 月 × 几号
      state.mode = "recurrence";
      state.every = 1;
      state.unit = "month";
      state.monthlyMode = "day";
      state.monthlyDay = schedule.day ?? 1;
      state.times = [schedule.time ?? "08:30"];
      break;
  }
}

importSchedule(props.modelValue);
watch(
  () => props.modelValue,
  (schedule) => importSchedule(schedule),
);

/** 编辑器状态 → 草稿 schedule（不完整时也照发，validate() 负责把关） */
function buildSchedule(): ScheduledTaskSchedule {
  switch (state.mode) {
    case "recurrence": {
      const schedule: ScheduledTaskSchedule = {
        kind: "recurrence",
        every: state.every,
        unit: state.unit,
      };
      if (state.unit === "week") {
        schedule.weekdays = [...state.weekdays];
      }
      if (state.unit === "month") {
        schedule.monthlyOn =
          state.monthlyMode === "day"
            ? { mode: "day", day: state.monthlyDay }
            : { mode: "nthWeekday", nth: state.monthlyNth, weekday: state.monthlyWeekday };
      }
      if (TIMED_UNITS.includes(state.unit)) {
        schedule.times = [...state.times];
      }
      if (TIMED_UNITS.includes(state.unit) && state.untilEnabled) {
        schedule.until = state.until;
      }
      return schedule;
    }
    case "window":
      return {
        kind: "window",
        startTime: state.windowStart,
        endTime: state.windowEnd,
        everyMinutes: state.everyMinutes,
      };
    case "once":
      return { kind: "once", at: new Date(`${state.onceDate}T${state.onceTime}`).getTime() };
    case "dates":
      return { kind: "dates", dates: [...state.dates], times: [...state.times] };
  }
}

watch(
  state,
  () => {
    const next = buildSchedule();
    // 与当前 modelValue 内容一致时不回发（导入引起的 state 重置不会触发循环）
    if (JSON.stringify(next) !== JSON.stringify(props.modelValue)) {
      emit("update:modelValue", next);
    }
  },
  { deep: true },
);

// 挂载时若草稿与入参不同（旧类型前向迁移等），立即回写一次让 v-model 保持一致
const initialSchedule = buildSchedule();
if (JSON.stringify(initialSchedule) !== JSON.stringify(props.modelValue)) {
  emit("update:modelValue", initialSchedule);
}

defineExpose({
  /** 提交前校验；返回错误文案键参数或 null */
  validate(): string | null {
    switch (state.mode) {
      case "recurrence": {
        if (!Number.isInteger(state.every) || state.every < 1) {
          return t("scheduler.errEvery");
        }
        if (TIMED_UNITS.includes(state.unit)) {
          if (!state.times.length) {
            return t("scheduler.errTimes");
          }
        }
        if (state.unit === "week" && !state.weekdays.length) {
          return t("scheduler.errWeekdays");
        }
        if (state.unit === "month" && state.monthlyMode === "day" && (state.monthlyDay < 1 || state.monthlyDay > 31)) {
          return t("scheduler.errDay");
        }
        if (state.untilEnabled && !/^\d{4}-\d{2}-\d{2}$/.test(state.until)) {
          return t("scheduler.errDate");
        }
        return null;
      }
      case "window": {
        if (state.everyMinutes < 1 || !Number.isInteger(state.everyMinutes)) {
          return t("scheduler.errWindowEvery");
        }
        const toMinutes = (value: string) => {
          const [h, m] = value.split(":").map(Number);
          return h * 60 + m;
        };
        if (toMinutes(state.windowStart) >= toMinutes(state.windowEnd)) {
          return t("scheduler.errWindowTime");
        }
        return null;
      }
      case "once": {
        const at = new Date(`${state.onceDate}T${state.onceTime}`).getTime();
        if (!Number.isFinite(at)) {
          return t("scheduler.errTime");
        }
        if (at <= Date.now()) {
          return t("scheduler.errOnceFuture");
        }
        return null;
      }
      case "dates":
        if (!state.dates.length) {
          return t("scheduler.errDates");
        }
        if (!state.times.length) {
          return t("scheduler.errTimes");
        }
        return null;
    }
  },
});

/** 截止方式下拉（reka-ui Select 不接受 boolean value，用字符串桥接） */
const untilChoice = computed({
  get: () => (state.untilEnabled ? "until-date" : "until-never"),
  set: (value: unknown) => {
    state.untilEnabled = String(value) === "until-date";
  },
});

// ---------- 时刻列表（重复·天/周/月 与 指定日期 共用） ----------

const MAX_TIMES = 5;

function addTime(): void {
  if (state.times.length < MAX_TIMES) {
    state.times.push("12:00");
  }
}

function removeTime(index: number): void {
  state.times.splice(index, 1);
}

// ---------- 日历预览（重复·天/周/月 与 指定日期 共用） ----------

const showCalendar = computed(
  () =>
    state.mode === "dates" ||
    (state.mode === "recurrence" && TIMED_UNITS.includes(state.unit)),
);

/** 日历当前展示月（placeholder），翻月时更新 */
const calendarPlaceholder = ref<CalendarDateValue>(today(getLocalTimeZone()));

function onPlaceholderUpdate(value: DateValue | undefined): void {
  if (value) {
    // reka-ui 的 DateValue 联合类型与 @internationalized/date 存在名义差异，此处收窄
    calendarPlaceholder.value = value as CalendarDateValue;
  }
}

/** 预览用的安全 schedule（草稿字段可能越界，先夹到合法域再算匹配） */
const previewSchedule = computed<ScheduledTaskSchedule>(() => {
  const draft = buildSchedule();
  if (draft.kind === "recurrence") {
    return {
      ...draft,
      every: Math.max(1, Math.floor(draft.every ?? 1)),
      weekdays: draft.weekdays?.length ? draft.weekdays : [1],
      monthlyOn:
        draft.monthlyOn ??
        ({ mode: "day", day: 1 } satisfies MonthlyPattern),
      times: draft.times?.length ? draft.times : ["09:00"],
    };
  }
  if (draft.kind === "dates") {
    return { ...draft, times: draft.times?.length ? draft.times : ["09:00"] };
  }
  return draft;
});

/** 当前展示月中会触发的日期（高亮） */
const highlightedDates = computed<DateValue[]>(() => {
  if (state.mode === "dates") {
    const monthPrefix = calendarPlaceholder.value.toString().slice(0, 7);
    return state.dates
      .filter((date) => date.startsWith(monthPrefix))
      .map((date) => parseDate(date));
  }
  const y = calendarPlaceholder.value.year;
  const m = calendarPlaceholder.value.month - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const matched: DateValue[] = [];
  for (let day = 1; day <= lastDay; day++) {
    if (matchesDate(previewSchedule.value, y, m, day)) {
      matched.push(new CalendarDate(y, m + 1, day));
    }
  }
  return matched;
});

/** 指定日期模式：日历多选增删 */
function onDatesSelect(value: DateValue[] | DateValue | undefined): void {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const next = new Set(state.dates);
  for (const date of list) {
    const iso = date.toString();
    if (next.has(iso)) {
      next.delete(iso);
    } else {
      next.add(iso);
    }
  }
  state.dates = [...next].sort();
}

/** 预览模式的日历是只读高亮（点击不改动），指定日期模式是交互多选 */
const calendarMultiple = computed(() => state.mode === "dates");

// ---------- 下次运行预览 ----------

const nextRuns = computed(() =>
  nextOccurrences(previewSchedule.value, Date.now(), 3).map((ts) => {
    const d = new Date(ts);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }),
);

function weekdayLabel(weekday: number): string {
  return t("scheduler.weekdaysShort").split(",")[weekday] ?? String(weekday);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- 模式：重复 / 每日时间范围 / 单次 / 指定日期 -->
    <Select v-model="state.mode">
      <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.schedule')">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="mode in MODES" :key="mode" :value="mode">
          {{ t(MODE_KEYS[mode]) }}
        </SelectItem>
      </SelectContent>
    </Select>

    <!-- 重复：每 N 单位（秒/分/时全天循环；天/周/月按日历挑日子） -->
    <template v-if="state.mode === 'recurrence'">
      <div class="grid grid-cols-[minmax(72px,90px)_minmax(0,1fr)] gap-2">
        <Input
          v-model.number="state.every"
          type="number"
          min="1"
          step="1"
          class="h-8 text-[12px]"
          :aria-label="t('scheduler.intervalEvery')"
        />
        <Select v-model="state.unit">
          <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.unit')">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="unit in UNITS" :key="unit" :value="unit">
              {{ t(UNIT_KEYS[unit]) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 周：星期几多选 -->
      <div v-if="state.unit === 'week'" class="flex flex-wrap gap-1">
        <Button
          v-for="weekday in WEEKDAYS"
          :key="weekday"
          :variant="state.weekdays.includes(weekday) ? 'default' : 'outline'"
          size="sm"
          class="h-7 min-w-8 px-1.5 text-[11px]"
          :aria-pressed="state.weekdays.includes(weekday)"
          @click="
            state.weekdays = state.weekdays.includes(weekday)
              ? state.weekdays.filter((item) => item !== weekday)
              : [...state.weekdays, weekday]
          "
        >
          {{ weekdayLabel(weekday) }}
        </Button>
      </div>

      <!-- 月：每月几号 或 第 N 个周几 -->
      <div v-else-if="state.unit === 'month'" class="flex flex-wrap items-center gap-2">
        <Select v-model="state.monthlyMode">
          <SelectTrigger class="h-8 min-w-[104px] text-[12px]" :aria-label="t('scheduler.monthlyMode')">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{{ t("scheduler.monthlyOnDay") }}</SelectItem>
            <SelectItem value="nthWeekday">{{ t("scheduler.monthlyOnNth") }}</SelectItem>
          </SelectContent>
        </Select>
        <template v-if="state.monthlyMode === 'day'">
          <Select v-model="state.monthlyDay">
            <SelectTrigger class="h-8 min-w-[72px] text-[12px]" :aria-label="t('scheduler.dayOfMonth')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="d in 31" :key="d" :value="d">{{ d }}</SelectItem>
            </SelectContent>
          </Select>
          <span class="text-[11px] text-[var(--color-mut)]">{{ t("scheduler.monthlyDaySuffix") }}</span>
        </template>
        <template v-else>
          <span class="text-[11px] text-[var(--color-mut)]">{{ t("scheduler.monthlyNthPrefix") }}</span>
          <Select v-model="state.monthlyNth">
            <SelectTrigger class="h-8 min-w-[64px] text-[12px]" :aria-label="t('scheduler.monthlyNthPrefix')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="n in 5" :key="n" :value="n">{{ n }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="state.monthlyWeekday">
            <SelectTrigger class="h-8 min-w-[88px] text-[12px]" :aria-label="t('scheduler.monthlyNthPrefix')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="weekday in WEEKDAYS" :key="weekday" :value="weekday">
                {{ weekdayLabel(weekday) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </template>
      </div>

      <!-- 天/周/月：一天多个运行时刻 + 截止日期 -->
      <template v-if="TIMED_UNITS.includes(state.unit)">
        <div class="flex flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <div
              v-for="(time, index) in state.times"
              :key="index"
              class="grid w-[128px] grid-cols-[minmax(0,1fr)_auto] gap-1"
            >
              <TimePicker v-model="state.times[index]" :aria-label="t('scheduler.time')" />
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="t('scheduler.removeTime')"
                @click="removeTime(index)"
              >
                <X class="size-3" />
              </Button>
            </div>
            <Button
              v-if="state.times.length < MAX_TIMES"
              variant="outline"
              size="sm"
              class="h-8 text-[11px]"
              @click="addTime"
            >
              <Plus class="size-3" />{{ t("scheduler.addTime") }}
            </Button>
          </div>
          <div class="flex items-center gap-2">
            <Select v-model="untilChoice">
              <SelectTrigger class="h-8 min-w-[96px] text-[12px]" :aria-label="t('scheduler.endLabel')">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="until-never">{{ t("scheduler.endNever") }}</SelectItem>
                <SelectItem value="until-date">{{ t("scheduler.endDate") }}</SelectItem>
              </SelectContent>
            </Select>
            <div v-if="state.untilEnabled" class="min-w-0 flex-1">
              <DateField v-model="state.until" :aria-label="t('scheduler.endDate')" />
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- 每日时间范围 -->
    <template v-else-if="state.mode === 'window'">
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(96px,120px)] gap-2">
        <TimePicker v-model="state.windowStart" :aria-label="t('scheduler.windowStart')" />
        <TimePicker v-model="state.windowEnd" :aria-label="t('scheduler.windowEnd')" />
        <Input
          v-model.number="state.everyMinutes"
          type="number"
          min="1"
          step="1"
          class="h-8 text-[12px]"
          :aria-label="t('scheduler.windowEvery')"
        />
      </div>
    </template>

    <!-- 单次 -->
    <template v-else-if="state.mode === 'once'">
      <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
        <DateField v-model="state.onceDate" :aria-label="t('scheduler.onceDate')" />
        <TimePicker v-model="state.onceTime" :aria-label="t('scheduler.onceTime')" />
      </div>
    </template>

    <!-- 指定日期：时刻列表（日期在日历上选） -->
    <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <div v-for="(time, index) in state.times" :key="index" class="grid w-[128px] grid-cols-[minmax(0,1fr)_auto] gap-1">
          <TimePicker v-model="state.times[index]" :aria-label="t('scheduler.time')" />
          <Button variant="ghost" size="icon-sm" :aria-label="t('scheduler.removeTime')" @click="removeTime(index)">
            <X class="size-3" />
          </Button>
        </div>
        <Button
          v-if="state.times.length < MAX_TIMES"
          variant="outline"
          size="sm"
          class="h-8 text-[11px]"
          @click="addTime"
        >
          <Plus class="size-3" />{{ t("scheduler.addTime") }}
        </Button>
        <span v-if="state.dates.length" class="text-[11px] text-[var(--color-mut)]">
          {{ t("scheduler.pickedDates", { n: state.dates.length }) }}
        </span>
      </div>
    </template>

    <!-- 日历（指定日期=多选交互；重复·天/周/月=只读高亮会运行的日期） -->
    <div v-if="showCalendar" class="flex justify-center rounded-xl border border-[var(--color-line)] p-2">
      <Calendar
        :model-value="highlightedDates"
        multiple
        :locale="locale"
        :default-placeholder="today(getLocalTimeZone())"
        layout="month-only"
        @update:placeholder="onPlaceholderUpdate"
        @update:model-value="calendarMultiple ? onDatesSelect($event as DateValue[] | DateValue | undefined) : undefined"
      />
    </div>

    <!-- 下次运行预览 -->
    <div class="flex items-center gap-1.5 text-[11px] text-[var(--color-mut)]">
      <CalendarClock class="size-3 shrink-0" aria-hidden="true" />
      <template v-if="nextRuns.length">
        <span class="shrink-0">{{ t("scheduler.nextRuns") }}：</span>
        <span class="truncate tabular-nums">{{ nextRuns.join(" · ") }}</span>
      </template>
      <span v-else>{{ t("scheduler.noUpcoming") }}</span>
    </div>
  </div>
</template>
