<script setup lang="ts">
import { storeToRefs } from "pinia";

import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";

const layoutStore = useLayoutStore();
const chatStore = useChatStore();
const { infoOpen } = storeToRefs(layoutStore);
const { sessionName, workspaceRoot, sessionId, statusText } = storeToRefs(chatStore);
</script>

<template>
  <div v-if="infoOpen" class="overlay" @click.self="layoutStore.toggleInfo()">
    <div class="popup" role="dialog" aria-modal="true" aria-label="基础信息">
      <header class="header">
        <h2>基础信息</h2>
        <button type="button" class="close" aria-label="关闭" @click="layoutStore.toggleInfo()">
          ×
        </button>
      </header>
      <dl class="list">
        <div class="row">
          <dt>会话</dt>
          <dd>{{ sessionName }}</dd>
        </div>
        <div class="row">
          <dt>会话 ID</dt>
          <dd class="mono">{{ sessionId }}</dd>
        </div>
        <div class="row">
          <dt>工作区</dt>
          <dd class="mono">{{ workspaceRoot || "未选择" }}</dd>
        </div>
        <div class="row">
          <dt>状态</dt>
          <dd>{{ statusText || "空闲" }}</dd>
        </div>
        <div class="row">
          <dt>应用</dt>
          <dd>Zen 0.1.0</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--color-scrim, #00000061);
  display: grid;
  place-items: center;
}

.popup {
  width: min(420px, calc(100vw - 48px));
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-line);
}

.header h2 {
  margin: 0;
  font-size: 14px;
  color: var(--color-txt-strong);
}

.close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--color-mut);
  font-size: 18px;
  line-height: 1;
}

.close:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.list {
  margin: 0;
  padding: 8px 0;
}

.row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 12px;
  padding: 10px 16px;
}

.row dt {
  color: var(--color-mut);
  font-size: 12px;
}

.row dd {
  margin: 0;
  color: var(--color-txt);
  font-size: 12px;
  word-break: break-all;
}

.mono {
  font-family: var(--font-mono);
}
</style>
