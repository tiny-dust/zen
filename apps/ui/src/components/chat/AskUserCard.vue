<script setup lang="ts">
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  HelpCircle,
  Send,
  UserRound,
} from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";

import type { AskUserOption, AskUserOptionPriority, AskUserQuestionEvent } from "@zen/shared";
import { askOptionLabel, askOptionPriority, sortAskOptions } from "@zen/shared";

/**
 * askUser 提问卡片：Agent 请求用户决策时显示在输入框上方。
 * 多问询合并为一张卡：单题展示 + 进度指示。答完一题先暂存（可在卡内返回修改），
 * 自动跳到下一道未答的题；全部答完后点「提交全部回答」一次性交给 Agent。
 * 只有一道题时保持「点一下即回答」的即时提交。
 * 优先级落在选项上：每条预设选项带推荐等级徽标（强烈推荐/推荐/一般/不推荐），
 * 列表按推荐度排序，帮助用户一眼看出模型更倾向哪条。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const asks = computed(() => chatStore.pendingAsks);

/** 当前展示的问询下标（多问询时在卡内切换） */
const currentIndex = ref(0);
const current = computed(() => asks.value[currentIndex.value]);

/** 每个问询的本地草稿（多选勾选 + 自由输入），按 askId 隔离 */
const drafts = reactive<Record<string, { freeText: string; picked: string[] }>>({});

/** 统一提交进行中：按钮禁用 + 文案切换，避免连点重复提交 */
const submitting = ref(false);

/** 已暂存的回答（askId → answer）：来自 store，跨题切换/返回修改都读它 */
function stagedAnswer(askId: string): string {
  return chatStore.askAnswers[askId] ?? "";
}

function isAnswered(ask: AskUserQuestionEvent): boolean {
  return stagedAnswer(ask.askId).length > 0;
}

const answeredCount = computed(() => asks.value.filter(isAnswered).length);
const allAnswered = computed(() => asks.value.length > 0 && answeredCount.value === asks.value.length);
/** 多问询：走「暂存 + 统一提交」，单问询即答 */
const isBatch = computed(() => asks.value.length > 1);

/** 选项推荐等级 → 徽标文案 / 悬浮说明 / 配色；等级是模型对「选项」的推荐，不是问题优先级 */
const OPTION_LEVEL_LABEL_KEY: Record<AskUserOptionPriority, string> = {
  strong: "chat.ask.optionLevelStrong",
  recommended: "chat.ask.optionLevelRecommended",
  neutral: "chat.ask.optionLevelNeutral",
  avoid: "chat.ask.optionLevelAvoid",
};
const OPTION_LEVEL_TITLE_KEY: Record<AskUserOptionPriority, string> = {
  strong: "chat.ask.optionLevelStrongTitle",
  recommended: "chat.ask.optionLevelRecommendedTitle",
  neutral: "chat.ask.optionLevelNeutralTitle",
  avoid: "chat.ask.optionLevelAvoidTitle",
};
const OPTION_LEVEL_CLASS: Record<AskUserOptionPriority, string> = {
  strong: "bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)] text-[var(--color-ok)]",
  recommended: "bg-[color-mix(in_srgb,var(--color-blue)_10%,transparent)] text-[var(--color-blue)]",
  neutral: "bg-[var(--color-chip-bg)] text-[var(--color-mut)]",
  avoid: "bg-[color-mix(in_srgb,var(--color-err)_12%,transparent)] text-[var(--color-err)]",
};

/** 选项展示顺序：强烈推荐在前、不推荐在后，未标注排末尾 */
function optionsOf(ask: AskUserQuestionEvent): Array<AskUserOption | string> {
  return sortAskOptions(ask.options);
}

function levelOf(option: AskUserOption | string): AskUserOptionPriority | undefined {
  return askOptionPriority(option);
}

function levelClass(option: AskUserOption | string): string {
  const level = levelOf(option);
  return level ? OPTION_LEVEL_CLASS[level] : "";
}

function levelLabel(option: AskUserOption | string): string {
  const level = levelOf(option);
  return level ? t(OPTION_LEVEL_LABEL_KEY[level]) : "";
}

function levelTitle(option: AskUserOption | string): string {
  const level = levelOf(option);
  return level ? t(OPTION_LEVEL_TITLE_KEY[level]) : "";
}

function draftOf(askId: string) {
  if (!drafts[askId]) {
    drafts[askId] = { freeText: "", picked: [] };
  }
  return drafts[askId];
}

// 问询队列变化：清掉已消失问询的草稿，并把下标夹回有效范围
watch(
  () => asks.value.map((item) => item.askId).join(","),
  () => {
    for (const key of Object.keys(drafts)) {
      if (!asks.value.some((item) => item.askId === key)) {
        delete drafts[key];
      }
    }
    currentIndex.value = Math.min(Math.max(currentIndex.value, 0), Math.max(asks.value.length - 1, 0));
  },
);

/** 跳到下一道未作答的题（从当前题往后找，绕回队首）；都答完则停在当前题 */
function jumpToNextUnanswered(fromId: string) {
  const list = asks.value;
  const from = list.findIndex((item) => item.askId === fromId);
  if (from < 0) {
    return;
  }
  for (let step = 1; step <= list.length; step += 1) {
    const index = (from + step) % list.length;
    const ask = list[index];
    if (ask && !isAnswered(ask)) {
      currentIndex.value = index;
      return;
    }
  }
  currentIndex.value = Math.min(from, list.length - 1);
}

/**
 * 回答当前题：多问询先暂存（可返回修改）并自动跳到下一题；
 * 单问询由 store 立即提交，卡片随之收掉。
 */
async function answer(ask: AskUserQuestionEvent, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  await chatStore.answerAsk(ask.askId, trimmed);
  const draft = draftOf(ask.askId);
  draft.picked = [];
  draft.freeText = "";
  if (isBatch.value) {
    jumpToNextUnanswered(ask.askId);
  }
}

function isMulti(ask: AskUserQuestionEvent) {
  return ask.multiSelect === true && ask.options.length > 0;
}

function isPicked(ask: AskUserQuestionEvent, option: string) {
  const draft = draftOf(ask.askId);
  if (isMulti(ask)) {
    return draft.picked.includes(option);
  }
  // 单选：重复点同一项仍按「修改答案」处理（覆盖暂存）
  return draft.picked.includes(option) || stagedAnswer(ask.askId) === option;
}

function pick(ask: AskUserQuestionEvent, option: string) {
  const draft = draftOf(ask.askId);
  if (isMulti(ask)) {
    draft.picked = draft.picked.includes(option)
      ? draft.picked.filter((item) => item !== option)
      : [...draft.picked, option];
    return;
  }
  void answer(ask, option);
}

function submitPicked(ask: AskUserQuestionEvent) {
  const draft = draftOf(ask.askId);
  if (!draft.picked.length) {
    return;
  }
  const extra = draft.freeText.trim();
  void answer(ask, [draft.picked.join("、"), extra].filter(Boolean).join("；补充："));
}

function submitFreeText(ask: AskUserQuestionEvent) {
  const draft = draftOf(ask.askId);
  if (!draft.freeText.trim()) {
    return;
  }
  if (draft.picked.length) {
    submitPicked(ask);
    return;
  }
  void answer(ask, draft.freeText);
}

/** 统一提交：把所有已暂存的回答一次性交给 Agent */
async function submitAll() {
  if (!allAnswered.value || submitting.value) {
    return;
  }
  submitting.value = true;
  try {
    await chatStore.submitAskAnswers();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    v-if="current"
    class="rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-composer)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
    role="group"
    :aria-label="t('chat.ask.title')"
  >
    <!-- 卡头：图标 + 标题 + 已答进度 + 上/下切换（优先级在选项上，不在题上） -->
    <div class="flex items-center gap-2.5">
      <div
        class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
      >
        <HelpCircle :size="15" />
      </div>
      <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-[var(--color-txt-strong)]">
        <span class="truncate">{{ t("chat.ask.title") }}</span>
      </div>
      <span v-if="asks.length > 1" class="flex-none text-[11px] font-normal text-[var(--color-mut)]">
        {{ t("chat.ask.answeredCount", { n: answeredCount, total: asks.length }) }}
      </span>
      <div v-if="asks.length > 1" class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('chat.ask.prevQuestion')"
          :disabled="currentIndex === 0"
          class="text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)]"
          @click="currentIndex -= 1"
        >
          <ChevronLeft class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('chat.ask.nextQuestion')"
          :disabled="currentIndex >= asks.length - 1"
          class="text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)]"
          @click="currentIndex += 1"
        >
          <ChevronRight class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- 进度点：已答实心、当前高亮、未答灰点；可点击跳转 -->
    <div
      v-if="asks.length > 1"
      class="mt-2 flex items-center gap-1.5 px-0.5"
      role="tablist"
      :aria-label="t('chat.ask.progress')"
    >
      <Button
        v-for="(ask, index) in asks"
        :key="ask.askId"
        variant="ghost"
        size="icon-xs"
        role="tab"
        :aria-selected="index === currentIndex"
        :aria-label="t('chat.ask.questionIndex', { n: index + 1 })"
        class="size-4 rounded-full p-0"
        @click="currentIndex = index"
      >
        <span
          class="size-1.5 rounded-full transition-colors duration-[var(--motion-fast)]"
          :class="
            index === currentIndex
              ? 'bg-[var(--color-accent)]'
              : isAnswered(ask)
                ? 'bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]'
                : 'bg-[var(--color-line-strong)]'
          "
          :aria-hidden="true"
        />
      </Button>
    </div>

    <!-- 当前问询主体 -->
    <div v-if="current" :key="current.askId" class="mt-2.5 flex items-start gap-2.5">
      <div class="min-w-0 flex-1">
        <div v-if="current.agentName" class="mb-1 flex items-center gap-1 text-[11px] text-[var(--color-mut)]">
          <UserRound class="size-3" aria-hidden="true" />
          <span>{{ t("chat.ask.agentAsks", { name: current.agentName }) }}</span>
        </div>
        <p class="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-txt-strong)]">
          {{ current.question }}
        </p>

        <!-- 已暂存的回答：多问询时可见，随时可重选覆盖 -->
        <p
          v-if="isBatch && isAnswered(current)"
          class="mt-1.5 mb-0 truncate rounded-lg bg-[var(--color-chip-bg)] px-2 py-1 text-[11px] text-[var(--color-mut)]"
          :title="t('chat.ask.answeredAs', { answer: stagedAnswer(current.askId) })"
        >
          {{ t("chat.ask.answeredAs", { answer: stagedAnswer(current.askId) }) }}
        </p>

        <!-- 选项竖向排列：单选圆点指示，多选方框勾选 -->
        <div
          v-if="current.options.length"
          class="mt-2.5 flex flex-col gap-1"
          role="listbox"
          :aria-multiselectable="isMulti(current)"
        >
          <Button
            v-for="option in optionsOf(current)"
            :key="askOptionLabel(option)"
            variant="ghost"
            role="option"
            :aria-selected="isPicked(current, askOptionLabel(option))"
            class="h-auto w-full justify-start gap-2 whitespace-normal rounded-lg border px-2.5 py-1.5 text-left font-normal text-[12px] md:text-[12px] transition-colors duration-[var(--motion-fast)]"
            :class="
              isPicked(current, askOptionLabel(option))
                ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:text-[var(--color-txt-strong)]'
                : 'border-[var(--color-line)] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
            "
            @click="pick(current, askOptionLabel(option))"
          >
            <span
              class="grid size-3.5 flex-none place-items-center border text-[var(--color-accent)]"
              :class="isMulti(current) ? 'rounded-[4px]' : 'rounded-full'"
              :aria-hidden="true"
            >
              <Check v-if="isPicked(current, askOptionLabel(option))" class="size-2.5" />
            </span>
            <span class="min-w-0 flex-1 break-words">{{ askOptionLabel(option) }}</span>
            <span
              v-if="levelOf(option)"
              class="flex-none rounded-full px-1.5 py-px text-[10px] leading-4 font-medium"
              :class="levelClass(option)"
              :title="levelTitle(option)"
            >
              {{ levelLabel(option) }}
            </span>
          </Button>
        </div>

        <!-- 多选：先勾选，再提交本题 -->
        <div v-if="isMulti(current)" class="mt-2 flex justify-end">
          <Button size="sm" :disabled="!draftOf(current.askId).picked.length" @click="submitPicked(current)">
            {{
              draftOf(current.askId).picked.length
                ? t("chat.ask.sendSelectedCount", { n: draftOf(current.askId).picked.length })
                : t("chat.ask.sendSelected")
            }}
          </Button>
        </div>

        <div
          v-if="current.allowFreeText"
          class="mt-2.5 flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2.5 py-1"
        >
          <Input
            :model-value="draftOf(current.askId).freeText"
            variant="ghost"
            type="text"
            class="h-7 min-w-0 flex-1 text-[12px] md:text-[12px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
            :placeholder="isMulti(current) ? t('chat.ask.freeTextWithMulti') : t('chat.ask.freeTextOnly')"
            :aria-label="t('chat.ask.freeAnswer')"
            @update:model-value="draftOf(current.askId).freeText = String($event)"
            @keydown.enter.prevent="submitFreeText(current)"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none rounded-lg text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)] disabled:opacity-40"
            :aria-label="t('chat.ask.submitAnswer')"
            :disabled="!draftOf(current.askId).freeText.trim() && !draftOf(current.askId).picked.length"
            :class="
              !draftOf(current.askId).freeText.trim() && !draftOf(current.askId).picked.length && 'opacity-40'
            "
            @click="submitFreeText(current)"
          >
            <CornerDownLeft class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 多问询：统一提交栏（答完全部才可提交，提交前可返回修改） -->
    <div
      v-if="isBatch"
      class="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--color-line-soft)] pt-2.5"
    >
      <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-mut)]" :title="t('chat.ask.submitAllHint')">
        {{ t("chat.ask.submitAllHint") }}
      </span>
      <Button size="sm" :disabled="!allAnswered || submitting" @click="submitAll">
        <Send class="size-3.5" aria-hidden="true" />
        {{
          submitting
            ? t("chat.ask.submitting")
            : allAnswered
              ? t("chat.ask.submitAllCount", { n: answeredCount, total: asks.length })
              : t("chat.ask.submitAll")
        }}
      </Button>
    </div>
  </div>
</template>
