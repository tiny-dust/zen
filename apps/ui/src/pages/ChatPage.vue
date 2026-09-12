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
      <div>
        <h1 class="title">Zen</h1>
        <p class="subtitle">极致精简 · 专注编程</p>
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
      <div class="composer-row">
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
        <div class="actions">
          <span class="status" :class="{ 'status-running': isRunning }">
            {{ statusText || "Enter 发送 · Shift+Enter 换行" }}
          </span>
          <BaseButton variant="ghost" :disabled="!isRunning" @click="chatStore.cancel()">
            停止
          </BaseButton>
          <BaseButton variant="primary" :disabled="!canSend" @click="chatStore.send()">
            发送
          </BaseButton>
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
  background:
    radial-gradient(circle at top left, rgba(125, 222, 162, 0.08), transparent 32%),
    var(--bg);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 18px 22px 12px;
  border-bottom: 1px solid var(--border);
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.subtitle {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 52%;
  min-width: 0;
}

.workspace-label {
  color: var(--text-muted);
  font-size: 12px;
  flex: none;
}

.workspace-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
}

.message-list {
  overflow: auto;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--text-muted);
}

.empty-hint {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.8;
}

.composer {
  border-top: 1px solid var(--border);
  padding: 14px 22px 18px;
  background: rgba(11, 13, 12, 0.92);
}

.error {
  margin: 0 0 10px;
  color: var(--danger);
  font-size: 12px;
}

.composer-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: end;
}

.input {
  resize: none;
  min-height: 78px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  padding: 12px 14px;
  outline: none;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.status {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.status-running {
  color: var(--accent);
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
