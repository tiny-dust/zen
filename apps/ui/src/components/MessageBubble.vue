<script setup lang="ts">
import { classes } from "rattail";
import { computed } from "vue";

import type { ChatMessage } from "@zen/shared";

const props = defineProps<{
  message: ChatMessage;
}>();

const roleLabel = computed(() => {
  return props.message.role === "user" ? "你" : "Zen";
});

const bubbleClass = computed(() => {
  return classes(
    "bubble",
    [props.message.role === "user", "bubble--user"],
    [props.message.role === "assistant", "bubble--assistant"],
    [props.message.role === "system", "bubble--system"],
    [props.message.role === "assistant" && !props.message.content, "bubble--empty"],
  );
});
</script>

<template>
  <div :class="classes('row', `row--${message.role}`)">
    <div class="avatar">{{ roleLabel }}</div>
    <div :class="bubbleClass">
      <p v-if="message.content" class="text">{{ message.content }}</p>
      <p v-else class="placeholder">正在思考…</p>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

.row--user {
  flex-direction: row-reverse;
}

.avatar {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--color-side-sel);
  border: 1px solid var(--color-line);
  color: var(--color-mut);
  font-size: 11px;
  font-weight: 500;
}

.bubble {
  max-width: min(720px, 78%);
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--color-line);
  color: var(--color-txt);
  background: var(--color-panel);
}

.bubble--user {
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
}

.bubble--assistant {
  background: var(--color-composer-surface);
}

.bubble--system {
  border-color: var(--color-notice-danger-border);
  background: var(--color-notice-danger-bg);
  color: var(--color-danger-fg);
}

.bubble--empty {
  color: var(--color-mut);
}

.text,
.placeholder {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.placeholder {
  color: var(--color-mut);
}
</style>
