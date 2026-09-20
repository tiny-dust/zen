<script setup lang="ts">
import { ArrowDown } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import ApprovalCard from "@/components/chat/ApprovalCard.vue";
import AskUserCard from "@/components/chat/AskUserCard.vue";
import { groupTimelineMessages } from "@/components/chat/message-groups";
import ToolCallGroup from "@/components/chat/ToolCallGroup.vue";
import MessageBubble from "@/components/MessageBubble.vue";
import { useChatStore } from "@/stores/chat";

import { getMessageRun } from "@zen/shared";

const chatStore = useChatStore();
const { messages, lastError } = storeToRefs(chatStore);
const timelineItems = computed(() => groupTimelineMessages(messages.value));

const listEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const showJump = ref(false);
/** 贴底跟随：用户上滚阅读时暂停自动滚动，接近底部时恢复 */
const stickToBottom = ref(true);

/** 顶部错误条：仅展示尚未归属到 assistant run 的错误，避免与消息终态行重复 */
const showTopError = computed(() => {
  if (!lastError.value) {
    return false;
  }
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index];
    if (message?.role === "assistant") {
      const run = getMessageRun(message);
      return run?.reason !== "error";
    }
  }
  return true;
});

function isFarFromBottom() {
  const el = listEl.value;
  if (!el) {
    return false;
  }
  return el.scrollHeight - el.scrollTop - el.clientHeight > 80;
}

function onScroll() {
  stickToBottom.value = !isFarFromBottom();
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
    if (stickToBottom.value) {
      scrollToBottom();
    }
  },
);

// markdown 是异步增量渲染，实际高度在 nextTick 之后才长出来；
// 用 ResizeObserver 兜底：内容长高且贴底时继续跟随，避免最新内容滞留视口外
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (stickToBottom.value) {
      const el = listEl.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
  if (contentEl.value) {
    resizeObserver.observe(contentEl.value);
  }
});
onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <section class="relative h-full min-h-0 min-w-0 flex-1 bg-[var(--color-main-bg)]" aria-label="对话">
    <div
      ref="listEl"
      class="flex h-full flex-col overflow-auto px-4 pb-3 pt-4 [overflow-anchor:none]"
      @scroll="onScroll"
    >
      <!-- Agent 提问与工具审批固定在对话区顶部，随时可见、方便操作 -->
      <div
        v-if="chatStore.pendingApproval || chatStore.pendingAsk"
        class="sticky top-0 z-10 -mx-4 mb-1 flex flex-col gap-2 bg-[var(--color-main-bg)] px-4 pb-2 pt-3"
      >
        <div class="mx-auto flex w-full max-w-[860px] flex-col gap-2">
          <ApprovalCard />
          <AskUserCard />
        </div>
      </div>

      <div
        ref="contentEl"
        class="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-4"
      >
        <div v-if="messages.length === 0" class="m-auto text-center text-[var(--color-mut)]">
          <p class="m-0">开始一段对话</p>
          <p class="mt-2 text-[12px] text-[var(--color-dim)]">
            在下方输入并发送，Agent 将流式回复。
          </p>
        </div>
        <template v-else>
          <p
            v-if="showTopError"
            class="mx-auto w-full rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-2.5 py-2 text-[12px] text-[var(--color-danger-fg)] shadow-[var(--shadow-tip)]"
            role="alert"
          >
            {{ lastError }}
          </p>
          <template v-for="item in timelineItems" :key="item.key">
            <ToolCallGroup v-if="item.type === 'tools'" :tools="item.tools" />
            <MessageBubble
              v-else
              :message="item.message"
              :streaming="chatStore.isRunning && item.message.id === messages.at(-1)?.id"
            />
          </template>
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