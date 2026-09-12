<script setup lang="ts">
import { storeToRefs } from "pinia";
import { nextTick, ref, watch } from "vue";

import MessageBubble from "@/components/MessageBubble.vue";
import { useChatStore } from "@/stores/chat";

const chatStore = useChatStore();
const { messages, lastError } = storeToRefs(chatStore);

const listEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

watch(messages, () => {
  scrollToBottom();
});
</script>

<template>
  <section class="chat-panel" aria-label="对话">
    <div ref="listEl" class="messages">
      <div v-if="messages.length === 0" class="empty">
        <p>开始一段对话</p>
        <p class="empty-hint">左侧输入后发送，Agent 将流式回复。</p>
      </div>
      <template v-else>
        <p v-if="lastError" class="error" role="alert">{{ lastError }}</p>
        <MessageBubble v-for="message in messages" :key="message.id" :message="message" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  min-width: 0;
  height: 100%;
  background: var(--color-main-bg);
}

.messages {
  height: 100%;
  overflow: auto;
  padding: 20px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--color-mut);
}

.empty p {
  margin: 0;
}

.empty-hint {
  margin-top: 8px !important;
  font-size: 12px;
  color: var(--color-dim);
}

.error {
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  color: var(--color-danger-fg);
  background: var(--color-danger-bg);
  border: 1px solid var(--color-notice-danger-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
}
</style>
