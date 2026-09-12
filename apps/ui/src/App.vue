<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted } from "vue";

import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatTimeline from "@/components/chat/ChatTimeline.vue";
import InfoPopup from "@/components/layout/InfoPopup.vue";
import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import RightPanel from "@/components/right/RightPanel.vue";
import SessionInfoPanel from "@/components/session/SessionInfoPanel.vue";
import AppSidebar from "@/components/sidebar/AppSidebar.vue";
import AppTopbar from "@/components/topbar/AppTopbar.vue";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const { leftWidth, rightWidth, rightCollapsed, bottomCollapsed, sessionOpen } =
  storeToRefs(layoutStore);

const isWide = useMediaQuery("(min-width: 1100px)");
const showSessionColumn = computed(() => isWide.value && sessionOpen.value);

const centerClass = computed(() => ({
  "center--wide": showSessionColumn.value,
}));

let dispose: (() => void) | undefined;

onMounted(() => {
  dispose = chatStore.bootstrap();
});

onUnmounted(() => {
  dispose?.();
});

function onLeftDrag(delta: number) {
  layoutStore.setLeftWidth(leftWidth.value + delta);
}

function onRightDrag(delta: number) {
  layoutStore.setRightWidth(rightWidth.value - delta);
}
</script>

<template>
  <div class="shell">
    <div class="body">
      <div class="left" :style="{ width: `${leftWidth}px` }">
        <AppSidebar />
      </div>

      <ResizeHandle orientation="vertical" @drag="onLeftDrag" />

      <div class="main">
        <AppTopbar :is-wide="isWide" />
        <div class="main-body">
          <div class="center" :class="centerClass">
            <div class="chat-column">
              <ChatTimeline />
              <ChatComposer />
            </div>
            <SessionInfoPanel v-if="showSessionColumn" />
          </div>

          <div v-if="!bottomCollapsed" class="bottom-bar">
            <span>底部面板 · 任务进度 / 终端占位</span>
          </div>
        </div>
      </div>

      <template v-if="!rightCollapsed">
        <ResizeHandle orientation="vertical" invert @drag="onRightDrag" />
        <div class="right" :style="{ width: `${rightWidth}px` }">
          <RightPanel />
        </div>
      </template>
    </div>

    <InfoPopup />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  background: var(--color-bg);
  color: var(--color-txt);
}

.body {
  display: flex;
  min-height: 0;
  height: 100%;
}

.left,
.right {
  flex: none;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.main {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

.main-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.center {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.center--wide {
  grid-template-columns: minmax(0, 1fr) 300px;
}

.chat-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bottom-bar {
  flex: none;
  height: 96px;
  border-top: 1px solid var(--color-line);
  background: var(--color-side);
  color: var(--color-mut);
  font-size: 12px;
  display: flex;
  align-items: center;
  padding: 0 14px;
}
</style>
