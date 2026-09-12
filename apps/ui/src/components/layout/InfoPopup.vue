<script setup lang="ts">
import { storeToRefs } from "pinia";

import SessionInfoPanel from "@/components/session/SessionInfoPanel.vue";
import { useLayoutStore } from "@/stores/layout";

const layoutStore = useLayoutStore();
const { infoOpen } = storeToRefs(layoutStore);
</script>

<template>
  <div v-if="infoOpen" class="overlay" @click.self="layoutStore.toggleInfo()">
    <div class="popup" role="dialog" aria-modal="true" aria-label="会话信息">
      <header class="header">
        <h2>会话信息</h2>
        <button type="button" class="close" aria-label="关闭" @click="layoutStore.toggleInfo()">
          ×
        </button>
      </header>
      <div class="body">
        <SessionInfoPanel embedded />
      </div>
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
  max-height: min(720px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
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

.body {
  overflow: auto;
  min-height: 0;
}
</style>
