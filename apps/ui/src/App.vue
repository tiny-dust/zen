<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import { useChatStore } from "@/stores/chat";

const chatStore = useChatStore();

let dispose: (() => void) | undefined;

onMounted(() => {
  dispose = chatStore.bootstrap();
});

onUnmounted(() => {
  dispose?.();
});
</script>

<template>
  <router-view />
</template>
