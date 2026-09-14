<script setup lang="ts">
import { storeToRefs } from "pinia";

import BaseButton from "@/components/base/BaseButton.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
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
  <div class="composer">
    <p v-if="isRunning || statusText" class="status">{{ statusText || "Agent 思考中…" }}</p>
    <div class="composer-card">
      <label class="sr-only" for="chat-input">消息输入</label>
      <textarea
        id="chat-input"
        v-model="input"
        class="input"
        rows="3"
        placeholder="描述你想让 Agent 做的事…（Enter 发送，Shift+Enter 换行）"
        :disabled="isRunning"
        @keydown="onKeydown"
      />
      <div class="actions">
        <ModelPicker />
        <div class="btns">
          <BaseButton v-if="isRunning" variant="ghost" @click="chatStore.cancel()">
            停止
          </BaseButton>
          <BaseButton variant="primary" :disabled="!canSend" @click="chatStore.send()">
            发送
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer {
  flex: none;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--color-line);
  background: var(--color-composer-tray-bg);
}

.status {
  max-width: 860px;
  margin: 0 auto 8px;
  font-size: 12px;
  color: var(--color-mut);
}

.composer-card {
  max-width: 860px;
  margin: 0 auto;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--color-input-border);
  background: var(--color-composer-surface);
  box-shadow: var(--shadow-composer);
}

.input {
  display: block;
  width: 100%;
  min-height: 64px;
  max-height: 180px;
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
  margin-top: 8px;
  flex-wrap: wrap;
}

.btns {
  display: flex;
  gap: 8px;
}

.hint {
  font-size: 11px;
  color: var(--color-dim);
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
