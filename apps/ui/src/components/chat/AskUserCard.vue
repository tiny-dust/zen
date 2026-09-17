<script setup lang="ts">
import { CornerDownLeft, HelpCircle } from "@lucide/vue";
import { ref } from "vue";

import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";

/**
 * askUser 提问卡片：Agent 请求用户决策时展示在输入框上方。
 * 选项按钮直接作答；也可自由输入后回车提交。
 */
const chatStore = useChatStore();
const freeText = ref("");

function pick(option: string) {
  chatStore.submitAsk(option);
}

function submitFreeText() {
  if (!freeText.value.trim()) {
    return;
  }
  chatStore.submitAsk(freeText.value);
  freeText.value = "";
}
</script>

<template>
  <div
    v-if="chatStore.pendingAsk"
    class="mb-2 rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-composer)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
    role="group"
    aria-label="Agent 提问"
  >
    <div class="flex items-start gap-2.5">
      <div
        class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
      >
        <HelpCircle :size="15" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-txt-strong)]">
          {{ chatStore.pendingAsk.question }}
        </p>
        <div
          v-if="chatStore.pendingAsk.options.length"
          class="mt-2.5 flex flex-wrap gap-1.5"
        >
          <Button
            v-for="option in chatStore.pendingAsk.options"
            :key="option"
            variant="outline"
            size="sm"
            class="max-w-full"
            @click="pick(option)"
          >
            <span class="truncate">{{ option }}</span>
          </Button>
        </div>
        <div
          v-if="chatStore.pendingAsk.allowFreeText"
          class="mt-2.5 flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2.5 py-1"
        >
          <input
            v-model="freeText"
            type="text"
            class="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-dim)]"
            placeholder="或输入你的回答…"
            aria-label="自由回答"
            @keydown.enter.prevent="submitFreeText"
          />
          <button
            type="button"
            class="flex size-6 flex-none items-center justify-center rounded-lg text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)]"
            aria-label="提交回答"
            :disabled="!freeText.trim()"
            :class="!freeText.trim() && 'opacity-40'"
            @click="submitFreeText"
          >
            <CornerDownLeft :size="14" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
