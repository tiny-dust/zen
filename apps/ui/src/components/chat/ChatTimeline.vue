<script setup lang="ts">
import { ArrowDown } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { nextTick, ref, watch } from "vue";

import AgentRunStatus from "@/components/chat/AgentRunStatus.vue";
import MessageBubble from "@/components/MessageBubble.vue";
import { useChatStore } from "@/stores/chat";

const chatStore = useChatStore();
const { messages, lastError } = storeToRefs(chatStore);

const listEl = ref<HTMLElement | null>(null);
const showJump = ref(false);

function isFarFromBottom() {
  const el = listEl.value;
  if (!el) {
    return false;
  }
  return el.scrollHeight - el.scrollTop - el.clientHeight > 80;
}

function onScroll() {
  showJump.value = isFarFromBottom();
}

function scrollToBottom(smooth = false) {
  void nextTick(() => {
    const el = listEl.value;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

// ref 源的 watch 是浅监听，push/流式 delta 这类嵌套变更不会触发；
// 精确监听会改变布局高度的三类变化：新消息、正文增长、推理文本增长
watch(
  () => [
    messages.value.length,
    messages.value.at(-1)?.content,
    messages.value.at(-1)?.reasoning,
  ],
  () => {
    scrollToBottom();
  },
);
</script>

<template>
  <section class="relative h-full min-h-0 min-w-0 flex-1 bg-[var(--color-main-bg)]" aria-label="对话">
    <div
      ref="listEl"
      class="flex h-full flex-col overflow-auto px-4 pb-3 pt-4"
      @scroll="onScroll"
    >
      <div class="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-3">
        <div v-if="messages.length === 0" class="m-auto text-center text-[var(--color-mut)]">
          <p class="m-0">开始一段对话</p>
          <p class="mt-2 text-[12px] text-[var(--color-dim)]">
            在下方输入并发送，Agent 将流式回复。
          </p>
        </div>
        <template v-else>
          <p
            v-if="lastError"
            class="mx-auto w-full rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-2.5 py-2 text-[12px] text-[var(--color-danger-fg)] shadow-[var(--shadow-tip)]"
            role="alert"
          >
            {{ lastError }}
          </p>
          <MessageBubble
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :streaming="chatStore.isRunning && message.id === messages.at(-1)?.id"
          />
          <AgentRunStatus />
        </template>
      </div>
    </div>

    <!-- 离底较远时出现，回到底部（MiMo 同构圆形按钮） -->
    <button
      v-show="showJump"
      type="button"
      class="absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-composer-surface)] text-[var(--color-txt)] shadow-[var(--shadow-tip)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)]"
      aria-label="滚到底部"
      @click="scrollToBottom(true)"
    >
      <ArrowDown class="size-4" />
    </button>
  </section>
</template>
