<script setup lang="ts">
import { storeToRefs } from "pinia";

import IconButton from "@/components/base/IconButton.vue";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const { sessionName, workspaceRoot } = storeToRefs(chatStore);
const { rightCollapsed, bottomCollapsed, infoOpen } = storeToRefs(layoutStore);
</script>

<template>
  <header class="topbar">
    <div class="cluster cluster--left">
      <IconButton label="搜索">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </svg>
      </IconButton>
      <IconButton label="通知">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 1.5 5H4.5S6 13 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      </IconButton>
    </div>

    <div class="cluster cluster--center">
      <span class="session-name" :title="workspaceRoot">{{ sessionName }}</span>
    </div>

    <div class="cluster cluster--right">
      <IconButton
        label="会话信息面板"
        :active="!bottomCollapsed"
        @click="layoutStore.toggleBottom()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M4 15h16" />
        </svg>
      </IconButton>
      <IconButton
        label="会话详情"
        :active="infoOpen"
        @click="layoutStore.toggleInfo()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      </IconButton>
      <IconButton
        label="右侧面板"
        :active="!rightCollapsed"
        @click="layoutStore.toggleRight()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M15 5v14" />
        </svg>
      </IconButton>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-side);
  -webkit-app-region: drag;
  user-select: none;
}

.cluster {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cluster--left {
  justify-content: flex-start;
}

.cluster--center {
  justify-content: center;
}

.cluster--right {
  justify-content: flex-end;
}

.session-name {
  max-width: 42vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-txt-strong);
}

.topbar :deep(.icon-button) {
  -webkit-app-region: no-drag;
}
</style>
