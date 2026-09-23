<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, CornerDownLeft, HelpCircle, UserRound } from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";

import type { AskUserQuestionEvent } from "@zen/shared";

/**
 * askUser 提问卡片：Agent 请求用户决策时显示在输入框上方。
 * 多问询合并为一张卡：单题展示 + 进度指示，回答一题自动切到下一题，
 * 也可用上一题/下一题（或进度点）在问询间切换；按 askId 独立应答。
 * 选项竖向一行行排列：单选点击即答；多选（multiSelect）勾选后统一提交。
 * 也可自由输入后回车提交。
 */
const chatStore = useChatStore();
const asks = computed(() => chatStore.pendingAsks);

/** 当前展示的问询下标（多问询时在卡内切换） */
const currentIndex = ref(0);
const current = computed(() => asks.value[currentIndex.value]);

/** 每个问询的本地草稿（多选勾选 + 自由输入），按 askId 隔离 */
const drafts = reactive<Record<string, { freeText: string; picked: string[] }>>({});

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

/** 回答当前问询后：队列由 store 同步移除，这里把下标夹回有效范围（自动露出下一题/收尾） */
function settleAfterAnswer() {
  currentIndex.value = Math.min(Math.max(currentIndex.value, 0), Math.max(asks.value.length - 1, 0));
}

function isMulti(ask: AskUserQuestionEvent) {
  return ask.multiSelect === true && ask.options.length > 0;
}

function pick(ask: AskUserQuestionEvent, option: string) {
  const draft = draftOf(ask.askId);
  if (isMulti(ask)) {
    draft.picked = draft.picked.includes(option)
      ? draft.picked.filter((item) => item !== option)
      : [...draft.picked, option];
    return;
  }
  void chatStore.submitAsk(ask.askId, option);
  settleAfterAnswer();
}

function submitPicked(ask: AskUserQuestionEvent) {
  const draft = draftOf(ask.askId);
  if (!draft.picked.length) {
    return;
  }
  const extra = draft.freeText.trim();
  void chatStore.submitAsk(
    ask.askId,
    [draft.picked.join("、"), extra].filter(Boolean).join("；补充："),
  );
  draft.picked = [];
  draft.freeText = "";
  settleAfterAnswer();
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
  void chatStore.submitAsk(ask.askId, draft.freeText);
  draft.freeText = "";
  settleAfterAnswer();
}
</script>

<template>
  <div
    v-if="current"
    class="rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-composer)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
    role="group"
    aria-label="Agent 提问"
  >
    <!-- 卡头：图标 + 标题 + 进度 + 上/下切换 -->
    <div class="flex items-center gap-2.5">
      <div
        class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
      >
        <HelpCircle :size="15" />
      </div>
      <div class="min-w-0 flex-1 text-[13px] font-medium text-[var(--color-txt-strong)]">
        Agent 提问
        <span v-if="asks.length > 1" class="ml-1 font-normal text-[11px] text-[var(--color-mut)]">
          {{ currentIndex + 1 }} / {{ asks.length }}
        </span>
      </div>
      <div v-if="asks.length > 1" class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="上一问"
          :disabled="currentIndex === 0"
          class="text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)]"
          @click="currentIndex -= 1"
        >
          <ChevronLeft class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="下一问"
          :disabled="currentIndex >= asks.length - 1"
          class="text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)]"
          @click="currentIndex += 1"
        >
          <ChevronRight class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- 进度点：可点击跳转 -->
    <div v-if="asks.length > 1" class="mt-2 flex items-center gap-1.5 px-0.5" role="tablist" aria-label="问询进度">
      <Button
        v-for="(ask, index) in asks"
        :key="ask.askId"
        variant="ghost"
        size="icon-xs"
        role="tab"
        :aria-selected="index === currentIndex"
        :aria-label="`第 ${index + 1} 问`"
        class="size-4 rounded-full p-0"
        @click="currentIndex = index"
      >
        <span
          class="size-1.5 rounded-full transition-colors duration-[var(--motion-fast)]"
          :class="
            index === currentIndex
              ? 'bg-[var(--color-accent)]'
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
          <span>{{ current.agentName }} 向你提问</span>
        </div>
        <p class="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-txt-strong)]">
          {{ current.question }}
        </p>

        <!-- 选项竖向排列：单选圆点指示，多选方框勾选 -->
        <div
          v-if="current.options.length"
          class="mt-2.5 flex flex-col gap-1"
          role="listbox"
          :aria-multiselectable="isMulti(current)"
        >
          <Button
            v-for="option in current.options"
            :key="option"
            variant="ghost"
            role="option"
            :aria-selected="draftOf(current.askId).picked.includes(option)"
            class="h-auto w-full justify-start gap-2 whitespace-normal rounded-lg border px-2.5 py-1.5 text-left font-normal text-[12.5px] md:text-[12.5px] transition-colors duration-[var(--motion-fast)]"
            :class="
              draftOf(current.askId).picked.includes(option)
                ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:text-[var(--color-txt-strong)]'
                : 'border-[var(--color-line)] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
            "
            @click="pick(current, option)"
          >
            <span
              class="grid size-3.5 flex-none place-items-center border text-[var(--color-accent)]"
              :class="isMulti(current) ? 'rounded-[4px]' : 'rounded-full'"
              :aria-hidden="true"
            >
              <Check v-if="draftOf(current.askId).picked.includes(option)" class="size-2.5" />
            </span>
            <span class="min-w-0 flex-1 break-words">{{ option }}</span>
          </Button>
        </div>

        <!-- 多选：统一提交按钮 -->
        <div v-if="isMulti(current)" class="mt-2 flex justify-end">
          <Button size="sm" :disabled="!draftOf(current.askId).picked.length" @click="submitPicked(current)">
            发送所选{{
              draftOf(current.askId).picked.length ? `（${draftOf(current.askId).picked.length}）` : ""
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
            class="h-7 min-w-0 flex-1 text-[12.5px] md:text-[12.5px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
            :placeholder="isMulti(current) ? '可补充说明后一并发送…' : '或输入你的回答…'"
            aria-label="自由回答"
            @update:model-value="draftOf(current.askId).freeText = String($event)"
            @keydown.enter.prevent="submitFreeText(current)"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none rounded-lg text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)] disabled:opacity-40"
            aria-label="提交回答"
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
  </div>
</template>
