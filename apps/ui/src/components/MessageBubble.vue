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
}

.row--user {
  flex-direction: row-reverse;
}

.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
}

.bubble {
  max-width: min(720px, 78%);
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.bubble--user {
  background: var(--user-bubble);
}

.bubble--assistant {
  background: var(--assistant-bubble);
}

.bubble--empty {
  color: var(--text-muted);
}

.text,
.placeholder {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.placeholder {
  color: var(--text-muted);
}
</style>
