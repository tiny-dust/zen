<script setup lang="ts">
import { Check, CornerDownLeft, HelpCircle, UserRound } from "@lucide/vue";
import { computed, reactive, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";

import type { AskUserQuestionEvent } from "@zen/shared";

/**
 * askUser 提问卡片：Agent 请求用户决策时显示在输入框上方。
 * 支持多问询并发——每个 ask 一张卡，按 askId 独立回答；回答一个推进一个。
 * 选项竖向一行行排列：单选点击即答；多选（multiSelect）勾选后统一提交。
 * 也可自由输入后回车提交。
 */
const chatStore = useChatStore();
const asks = computed(() => chatStore.pendingAsks);

/** 每张卡的本地草稿（多选勾选 + 自由输入），按 askId 隔离 */
const drafts = reactive<Record<string, { freeText: string; picked: string[] }>>({});

function draftOf(askId: string) {
  if (!drafts[askId]) {
    drafts[askId] = { freeText: "", picked: [] };
  }
  return drafts[askId];
}

// 问题消失后清掉对应草稿
watch(
  () => asks.value.map((item) => item.askId).join(","),
  () => {
    for (const key of Object.keys(drafts)) {
      if (!asks.value.some((item) => item.askId === key)) {
        delete drafts[key];
      }
    }
  },
);

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
}
</script>

<template>
  <div v-if="asks.length" class="flex flex-col gap-2" role="group" aria-label="Agent 提问">
    <div
      v-for="ask in asks"
      :key="ask.askId"
      class="rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-composer)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
    >
      <div class="flex items-start gap-2.5">
        <div
          class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
        >
          <HelpCircle :size="15" />
        </div>
        <div class="min-w-0 flex-1">
          <div v-if="ask.agentName" class="mb-1 flex items-center gap-1 text-[11px] text-[var(--color-mut)]">
            <UserRound class="size-3" aria-hidden="true" />
            <span>{{ ask.agentName }} 向你提问</span>
          </div>
          <p class="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-txt-strong)]">
            {{ ask.question }}
          </p>

          <!-- 选项竖向排列：单选圆点指示，多选方框勾选 -->
          <div
            v-if="ask.options.length"
            class="mt-2.5 flex flex-col gap-1"
            role="listbox"
            :aria-multiselectable="isMulti(ask)"
          >
            <Button
              v-for="option in ask.options"
              :key="option"
              variant="ghost"
              role="option"
              :aria-selected="draftOf(ask.askId).picked.includes(option)"
              class="h-auto w-full justify-start gap-2 rounded-lg border px-2.5 py-1.5 text-left font-normal text-[12.5px] md:text-[12.5px] transition-colors duration-[var(--motion-fast)]"
              :class="
                draftOf(ask.askId).picked.includes(option)
                  ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:text-[var(--color-txt-strong)]'
                  : 'border-[var(--color-line)] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
              "
              @click="pick(ask, option)"
            >
              <span
                class="grid size-3.5 flex-none place-items-center border text-[var(--color-accent)]"
                :class="isMulti(ask) ? 'rounded-[4px]' : 'rounded-full'"
                :aria-hidden="true"
              >
                <Check v-if="draftOf(ask.askId).picked.includes(option)" class="size-2.5" />
              </span>
              <span class="min-w-0 flex-1 break-words">{{ option }}</span>
            </Button>
          </div>

          <!-- 多选：统一提交按钮 -->
          <div v-if="isMulti(ask)" class="mt-2 flex justify-end">
            <Button size="sm" :disabled="!draftOf(ask.askId).picked.length" @click="submitPicked(ask)">
              发送所选{{
                draftOf(ask.askId).picked.length ? `（${draftOf(ask.askId).picked.length}）` : ""
              }}
            </Button>
          </div>

          <div
            v-if="ask.allowFreeText"
            class="mt-2.5 flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2.5 py-1"
          >
            <Input
              :model-value="draftOf(ask.askId).freeText"
              variant="ghost"
              type="text"
              class="h-7 min-w-0 flex-1 text-[12.5px] md:text-[12.5px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
              :placeholder="isMulti(ask) ? '可补充说明后一并发送…' : '或输入你的回答…'"
              aria-label="自由回答"
              @update:model-value="draftOf(ask.askId).freeText = String($event)"
              @keydown.enter.prevent="submitFreeText(ask)"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              class="flex-none rounded-lg text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)] disabled:opacity-40"
              aria-label="提交回答"
              :disabled="!draftOf(ask.askId).freeText.trim() && !draftOf(ask.askId).picked.length"
              :class="
                !draftOf(ask.askId).freeText.trim() && !draftOf(ask.askId).picked.length && 'opacity-40'
              "
              @click="submitFreeText(ask)"
            >
              <CornerDownLeft class="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
