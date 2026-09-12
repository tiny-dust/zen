<script setup lang="ts">
import BaseButton from "@/components/base/BaseButton.vue";
import MessageBubble from "@/components/MessageBubble.vue";
import { useChatStore } from "@/stores/chat";
import { storeToRefs } from "pinia";
import { nextTick, ref, watch } from "vue";

const chatStore = useChatStore();
const { messages, isRunning, canSend, lastError, statusText, workspaceRoot, input } =
  storeToRefs(chatStore);

const listEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void chatStore.send();
  }
}

watch(messages, () => {
  scrollToBottom();
});
</script>

<template>
  <div class="chat-page">
    <header class="topbar">
      <div class="brand">
        <div>
          <h1 class="title">Zen</h1>
          <p class="subtitle">极致精简 · 专注编程</p>
        </div>
      </div>
      <div class="workspace">
        <span class="workspace-label">工作区</span>
        <code class="workspace-path">{{ workspaceRoot || "未选择" }}</code>
      </div>
    </header>

    <main ref="listEl" class="message-list">
      <div v-if="messages.length === 0" class="empty">
        <p>输入一句话，开始和 Agent 对话。</p>
        <p class="empty-hint">当前为 P0 壳：主进程假流式回复，尚未接入模型。</p>
      </div>
      <MessageBubble v-for="message in messages" :key="message.id" :message="message" />
    </main>

    <footer class="composer">
      <p v-if="lastError" class="error" role="alert">
        {{ lastError }}
      </p>
      <div class="composer-card">
        <label class="sr-only" for="chat-input">消息输入</label>
        <textarea
          id="chat-input"
          v-model="input"
          class="input"
          rows="3"
          placeholder="描述你想完成的事…（Enter 发送，Shift+Enter 换行）"
          :disabled="isRunning"
          @keydown="onKeydown"
        />
        <div class="composer-actions">
          <span class="status" :class="{ 'status-running': isRunning }">
            {{ statusText || "Enter 发送 · Shift+Enter 换行" }}
          </span>
          <div class="btns">
            <BaseButton variant="ghost" :disabled="!isRunning" @click="chatStore.cancel()">
              停止
            </BaseButton>
            <BaseButton variant="primary" :disabled="!canSend" @click="chatStore.send()">
              发送
            </BaseButton>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.chat-page {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--color-main-bg);
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-side);
  color: var(--color-topbar-icon);
}

.brand {
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-txt-strong);
  line-height: 1.2;
}

.subtitle {
  margin: 2px 0 0;
  color: var(--color-mut);
  font-size: 12px;
  line-height: 1.2;
}

.workspace {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 52%;
  min-width: 0;
}

.workspace-label {
  color: var(--color-mut);
  font-size: 12px;
  flex: none;
}

.workspace-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-txt);
  background: var(--color-input-bg);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.message-list {
  overflow: auto;
  padding: 24px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--color-main-bg);
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

.composer {
  padding: 12px 20px 18px;
  background: var(--color-composer-tray-bg);
}

.error {
  max-width: 900px;
  margin: 0 auto 10px;
  color: var(--color-danger-fg);
  background: var(--color-danger-bg);
  border: 1px solid var(--color-notice-danger-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
}

.composer-card {
  max-width: 900px;
  margin: 0 auto;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--color-input-border);
  background: var(--color-composer-surface);
  box-shadow: var(--shadow-composer);
  transition: border-color var(--motion-fast) var(--ease-enter);
}

.composer-card:focus-within {
  border-color: color-mix(in srgb, var(--color-txt-strong) 18%, var(--color-input-border));
}

.input {
  display: block;
  width: 100%;
  min-height: 72px;
  max-height: 200px;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-txt-strong);
  line-height: 1.5;
  padding: 0;
}

.input::placeholder {
  color: var(--color-composer-placeholder);
}

.input:disabled {
  opacity: 0.7;
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.btns {
  display: flex;
  gap: 8px;
}

.status {
  color: var(--color-mut);
  font-size: 12px;
}

.status-running {
  color: var(--color-accent);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
