<script setup lang="ts">
import { storeToRefs } from "pinia";

import BaseButton from "@/components/base/BaseButton.vue";
import { useChatStore } from "@/stores/chat";

const chatStore = useChatStore();
const { input, isRunning, canSend, statusText } = storeToRefs(chatStore);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void chatStore.send();
  }
}
</script>

<template>
  <section class="input-panel" aria-label="输入">
    <div class="panel-title">输入</div>
    <div class="composer-card">
      <label class="sr-only" for="side-chat-input">消息输入</label>
      <textarea
        id="side-chat-input"
        v-model="input"
        class="input"
        rows="12"
        placeholder="描述你想让 Agent 做的事…"
        :disabled="isRunning"
        @keydown="onKeydown"
      />
      <div class="actions">
        <span class="status">{{ statusText || "Enter 发送" }}</span>
        <div class="btns">
          <BaseButton
            v-if="isRunning"
            variant="ghost"
            @click="chatStore.cancel()"
          >
            停止
          </BaseButton>
          <BaseButton variant="primary" :disabled="!canSend" @click="chatStore.send()">
            发送
          </BaseButton>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.input-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  height: 100%;
  padding: 12px;
  background: var(--color-side);
  border-right: 1px solid var(--color-line);
}

.panel-title {
  font-size: 12px;
  color: var(--color-mut);
  padding: 0 2px;
}

.composer-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--color-input-border);
  background: var(--color-composer-surface);
  box-shadow: var(--shadow-composer);
}

.input {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-txt-strong);
  line-height: 1.5;
}

.input::placeholder {
  color: var(--color-composer-placeholder);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.btns {
  display: flex;
  gap: 8px;
}

.status {
  font-size: 11px;
  color: var(--color-mut);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
