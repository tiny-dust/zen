<script setup lang="ts">
import { Check, CornerDownLeft, HelpCircle } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";

/**
 * askUser 提问卡片：Agent 请求用户决策时固定在对话区顶部。
 * 选项竖向一行行排列：单选点击即答；多选（multiSelect）勾选后统一提交。
 * 也可自由输入后回车提交。
 */
const chatStore = useChatStore();
const freeText = ref("");
/** 多选模式下已勾选的选项 */
const picked = ref<string[]>([]);

const ask = computed(() => chatStore.pendingAsk);
const isMulti = computed(() => ask.value?.multiSelect === true && ask.value.options.length > 0);

// 新问题到来时清空上次的选择与输入
watch(
  () => ask.value?.askId,
  () => {
    picked.value = [];
    freeText.value = "";
  },
);

function pick(option: string) {
  if (isMulti.value) {
    picked.value = picked.value.includes(option)
      ? picked.value.filter((item) => item !== option)
      : [...picked.value, option];
    return;
  }
  chatStore.submitAsk(option);
}

function submitPicked() {
  if (!picked.value.length) {
    return;
  }
  const extra = freeText.value.trim();
  chatStore.submitAsk([picked.value.join("、"), extra].filter(Boolean).join("；补充："));
  picked.value = [];
  freeText.value = "";
}

function submitFreeText() {
  if (!freeText.value.trim()) {
    return;
  }
  if (picked.value.length) {
    submitPicked();
    return;
  }
  chatStore.submitAsk(freeText.value);
  freeText.value = "";
}
</script>

<template>
  <div
    v-if="chatStore.pendingAsk"
    class="rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-composer)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
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

        <!-- 选项竖向排列：单选圆点指示，多选方框勾选 -->
        <div
          v-if="chatStore.pendingAsk.options.length"
          class="mt-2.5 flex flex-col gap-1"
          role="listbox"
          :aria-multiselectable="isMulti"
        >
          <Button
            v-for="option in chatStore.pendingAsk.options"
            :key="option"
            variant="ghost"
            role="option"
            :aria-selected="picked.includes(option)"
            class="h-auto w-full justify-start gap-2 rounded-lg border px-2.5 py-1.5 text-left font-normal text-[12.5px] md:text-[12.5px] transition-colors duration-[var(--motion-fast)]"
            :class="
              picked.includes(option)
                ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:text-[var(--color-txt-strong)]'
                : 'border-[var(--color-line)] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
            "
            @click="pick(option)"
          >
            <span
              class="grid size-3.5 flex-none place-items-center border text-[var(--color-accent)]"
              :class="isMulti ? 'rounded-[4px]' : 'rounded-full'"
              :aria-hidden="true"
            >
              <Check v-if="picked.includes(option)" class="size-2.5" />
            </span>
            <span class="min-w-0 flex-1 break-words">{{ option }}</span>
          </Button>
        </div>

        <!-- 多选：统一提交按钮 -->
        <div v-if="isMulti" class="mt-2 flex justify-end">
          <Button size="sm" :disabled="!picked.length" @click="submitPicked">
            发送所选{{ picked.length ? `（${picked.length}）` : "" }}
          </Button>
        </div>

        <div
          v-if="chatStore.pendingAsk.allowFreeText"
          class="mt-2.5 flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2.5 py-1"
        >
          <Input
            v-model="freeText"
            variant="ghost"
            type="text"
            class="h-7 min-w-0 flex-1 text-[12.5px] md:text-[12.5px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
            :placeholder="isMulti ? '可补充说明后一并发送…' : '或输入你的回答…'"
            aria-label="自由回答"
            @keydown.enter.prevent="submitFreeText"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none rounded-lg text-[var(--color-mut)] transition-colors hover:text-[var(--color-txt-strong)] disabled:opacity-40"
            aria-label="提交回答"
            :disabled="!freeText.trim() && !picked.length"
            :class="!freeText.trim() && !picked.length && 'opacity-40'"
            @click="submitFreeText"
          >
            <CornerDownLeft class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
