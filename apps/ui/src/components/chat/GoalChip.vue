<script setup lang="ts">
import { Bell, Check, PauseCircle, Play, Target, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat";

import type { SessionGoal, SessionGoalStatus } from "@zen/shared";

/**
 * 输入框底栏的会话目标（Goals 目标模式）入口：
 * 无目标 = 小入口「设定目标」；有目标 = 摘要 chip（状态色点 + 截断文本 + 预算标签）。
 * Popover 内可编辑文本/预算并做暂停、标记完成、清除。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const { sessionGoal, goalBudgetLabel } = storeToRefs(chatStore);

/** 目标状态 → 状态色点 token（§4.1 语义色：active=success，paused=中性灰，blocked=警示，complete=主色） */
const STATUS_COLOR: Record<SessionGoalStatus, string> = {
  active: "var(--color-ok)",
  paused: "var(--color-mut)",
  blocked: "var(--color-accent-2)",
  complete: "var(--color-accent)",
};

// ---------- 弹层本地编辑态：打开时从 store 拷贝，保存时一次性提交 ----------
const open = ref(false);
const draftText = ref("");
const draftBudget = ref("");
const draftAutoContinue = ref(false);
const draftReminderInterval = ref("off");

watch(open, (value) => {
  if (!value) {
    return;
  }
  const goal = sessionGoal.value;
  draftText.value = goal?.text ?? "";
  draftBudget.value = goal?.tokenBudget ? String(goal.tokenBudget) : "";
  draftAutoContinue.value = goal?.autoContinue === true;
  draftReminderInterval.value = String(goal?.reminderIntervalHours ?? "off");
});

// 会话切换时关闭旧目标表单，避免把未保存的草稿写进新会话。
watch(() => chatStore.sessionId, () => {
  open.value = false;
});

function parseBudget(): number | null {
  const trimmed = draftBudget.value.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

const canSave = computed(() => draftText.value.trim().length > 0);

function reminderLabel(hours: number): string {
  return hours === 1
    ? t("goal.reminderHourly")
    : t("goal.reminderEvery", { hours });
}

function save() {
  if (!canSave.value) {
    return;
  }
  const goal: SessionGoal = {
    text: draftText.value.trim(),
    // 编辑保留原状态；首次设定默认 active
    status: sessionGoal.value?.status ?? "active",
    tokenBudget: parseBudget(),
    ...(draftAutoContinue.value ? { autoContinue: true } : {}),
    ...(draftReminderInterval.value !== "off"
      ? { reminderIntervalHours: Number(draftReminderInterval.value) }
      : {}),
  };
  void chatStore.setSessionGoal(goal);
  open.value = false;
}

function togglePaused() {
  const status = sessionGoal.value?.status;
  void chatStore.updateGoalStatus(status === "paused" ? "active" : "paused");
  open.value = false;
}

function markComplete() {
  void chatStore.updateGoalStatus("complete");
  open.value = false;
}

function clearGoal() {
  void chatStore.setSessionGoal(null);
  open.value = false;
}

const statusDotColor = computed(() =>
  sessionGoal.value ? STATUS_COLOR[sessionGoal.value.status] : "var(--color-mut)",
);
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <!-- 无目标：小入口「设定目标」；有目标：摘要 chip（状态点 + 截断文本 + 预算标签） -->
      <Button
        variant="ghost"
        class="min-w-0 items-center gap-1.5 rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :class="sessionGoal ? 'h-7 max-w-[240px] px-2' : 'h-7 px-2'"
        :aria-label="sessionGoal ? t('goal.pickerTitle') : t('goal.setAria')"
        :title="sessionGoal?.text"
      >
        <Target class="size-3.5 flex-none" aria-hidden="true" />
        <template v-if="sessionGoal">
          <span
            class="size-1.5 flex-none rounded-full"
            :style="{ backgroundColor: statusDotColor }"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate text-[11px] font-normal">
            {{ sessionGoal.text }}
          </span>
          <span
            v-if="goalBudgetLabel"
            class="flex-none font-[family-name:var(--font-mono)] text-[10px] tabular-nums text-[var(--color-dim)]"
          >
            {{ goalBudgetLabel }}
          </span>
          <Bell
            v-if="sessionGoal.status === 'active' && sessionGoal.reminderIntervalHours"
            class="size-3 flex-none text-[var(--color-accent)]"
            :aria-label="t('goal.reminderActive')"
          />
        </template>
        <span v-else class="text-[11px] font-normal">{{ t("goal.set") }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 p-3" :aria-label="t('goal.pickerTitle')">
      <div class="text-[12px] font-medium text-[var(--color-txt)]">{{ t("goal.pickerTitle") }}</div>
      <!-- 状态 + 预算消耗（有目标且已设预算时展示） -->
      <div
        v-if="sessionGoal"
        class="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-mut)]"
      >
        <span class="flex items-center gap-1">
          <span
            class="size-1.5 rounded-full"
            :style="{ backgroundColor: statusDotColor }"
            aria-hidden="true"
          />
          {{ t(`goal.status.${sessionGoal.status}`) }}
        </span>
        <span v-if="goalBudgetLabel" class="font-[family-name:var(--font-mono)] tabular-nums">
          {{ goalBudgetLabel }}
        </span>
        <span v-if="sessionGoal.status === 'active' && sessionGoal.reminderIntervalHours">
          {{ reminderLabel(sessionGoal.reminderIntervalHours) }}
        </span>
      </div>

      <!-- 目标文本 -->
      <label class="mt-2.5 block text-[11px] text-[var(--color-mut)]" for="goal-text">
        {{ t("goal.textLabel") }}
      </label>
      <Textarea
        id="goal-text"
        v-model="draftText"
        class="mt-1 min-h-[64px] resize-none text-[12px] leading-relaxed"
        :placeholder="t('goal.textPlaceholder')"
      />

      <!-- token 预算 -->
      <label class="mt-2 block text-[11px] text-[var(--color-mut)]" for="goal-budget">
        {{ t("goal.budgetLabel") }}
      </label>
      <Input
        id="goal-budget"
        v-model="draftBudget"
        type="number"
        min="1"
        class="mt-1 h-7 px-2 text-[12px] tabular-nums"
        :placeholder="t('goal.budgetPlaceholder')"
      />

      <div class="mt-2.5 flex items-start justify-between gap-3">
        <div class="flex flex-col gap-0.5">
          <label class="text-[11px] text-[var(--color-txt)]" for="goal-auto-continue">
            {{ t("goal.autoContinue") }}
          </label>
          <p class="m-0 text-[11px] leading-relaxed text-[var(--color-mut)]">
            {{ t("goal.autoContinueHint") }}
          </p>
        </div>
        <Switch id="goal-auto-continue" v-model="draftAutoContinue" :aria-label="t('goal.autoContinue')" />
      </div>

      <div class="mt-2.5">
        <label class="block text-[11px] text-[var(--color-txt)]" for="goal-reminder">
          {{ t("goal.reminderLabel") }}
        </label>
        <p class="m-0 mt-0.5 text-[11px] leading-relaxed text-[var(--color-mut)]">
          {{ t("goal.reminderHint") }}
        </p>
        <Select v-model="draftReminderInterval">
          <SelectTrigger id="goal-reminder" class="mt-1.5 h-8 w-full text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{{ t("goal.reminderOff") }}</SelectItem>
            <SelectItem value="1">{{ reminderLabel(1) }}</SelectItem>
            <SelectItem value="4">{{ reminderLabel(4) }}</SelectItem>
            <SelectItem value="24">{{ reminderLabel(24) }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 操作行：保存 / 暂停·继续 / 标记完成 / 清除 -->
      <div class="mt-3 flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          class="h-7 px-2.5 text-[12px]"
          :disabled="!canSave"
          @click="save"
        >
          {{ t("goal.save") }}
        </Button>
        <template v-if="sessionGoal">
          <Button
            v-if="sessionGoal.status !== 'paused'"
            variant="ghost"
            size="sm"
            class="h-7 items-center gap-1 px-2 text-[12px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('goal.pause')"
            :title="t('goal.pauseTitle')"
            @click="togglePaused"
          >
            <PauseCircle class="size-3.5" aria-hidden="true" />
            {{ t("goal.pause") }}
          </Button>
          <Button
            v-else
            variant="ghost"
            size="sm"
            class="h-7 items-center gap-1 px-2 text-[12px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('goal.resume')"
            :title="t('goal.resumeTitle')"
            @click="togglePaused"
          >
            <Play class="size-3.5" aria-hidden="true" />
            {{ t("goal.resume") }}
          </Button>
          <Button
            v-if="sessionGoal.status !== 'complete'"
            variant="ghost"
            size="sm"
            class="h-7 items-center gap-1 px-2 text-[12px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('goal.complete')"
            :title="t('goal.completeTitle')"
            @click="markComplete"
          >
            <Check class="size-3.5" aria-hidden="true" />
            {{ t("goal.complete") }}
          </Button>
          <!-- 清除为低视觉权重危险入口：hover 才转 destructive（§6.4） -->
          <Button
            variant="ghost"
            size="icon-xs"
            class="ml-auto rounded-md text-[var(--color-dim)] hover:text-[var(--color-danger-fg)]"
            :aria-label="t('goal.clear')"
            :title="t('goal.clearTitle')"
            @click="clearGoal"
          >
            <Trash2 class="size-3.5" aria-hidden="true" />
          </Button>
        </template>
      </div>
    </PopoverContent>
  </Popover>
</template>
