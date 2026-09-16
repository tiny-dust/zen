<script setup lang="ts">
import { ChevronDown, Loader2 } from "@lucide/vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed, ref } from "vue";

import type { ChatMessage } from "@zen/shared";

const props = defineProps<{
  message: ChatMessage;
  streaming?: boolean;
}>();

const contentHtml = computed(() => {
  if (props.message.role !== "assistant" || !props.message.content) {
    return "";
  }
  const html = marked.parse(props.message.content, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
});

const reasoningActive = computed(
  () => props.streaming === true && !props.message.content && !!props.message.reasoning,
);

const autoOpen = computed(() => !!props.message.reasoning && !props.message.content);
const manualOpen = ref<boolean | null>(null);
const reasoningOpen = computed(() => manualOpen.value ?? autoOpen.value);

const reasoningDuration = computed(() => {
  const ms = props.message.reasoningMs;
  if (!ms) {
    return "";
  }
  return `（${(ms / 1000).toFixed(1)}s）`;
});

const attachments = computed(() => {
  const meta = props.message.meta as { attachments?: Array<{ name: string }> } | undefined;
  return meta?.attachments ?? [];
});

function toggleReasoning() {
  manualOpen.value = !reasoningOpen.value;
}
</script>

<template>
  <!-- user：右对齐弱气泡；assistant：裸内容直接铺在背板上（MiMo 同构） -->
  <div v-if="message.role === 'user'" class="flex w-full justify-end">
    <div
      class="max-w-[min(760px,85%)] rounded-2xl bg-[var(--color-side-sel)] px-3.5 py-2.5 text-[var(--color-txt-strong)]"
    >
      <div class="m-0 whitespace-pre-wrap break-words">{{ message.content }}</div>
      <div v-if="attachments.length" class="mt-2 flex flex-wrap gap-1.5">
        <span
          v-for="att in attachments"
          :key="att.name"
          class="rounded-full bg-[var(--color-chip-bg)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-chip-text)]"
        >
          ${{ att.name }}
        </span>
      </div>
    </div>
  </div>

  <div v-else-if="message.role === 'system'" class="w-full">
    <div
      class="rounded-[var(--radius-sm)] bg-[var(--color-notice-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--color-danger-fg)]"
      role="alert"
    >
      {{ message.content }}
    </div>
  </div>

  <div v-else class="w-full">
    <button
      v-if="message.reasoning"
      type="button"
      class="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-chip-bg)] px-2 py-[3px] text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
      @click="toggleReasoning"
    >
      <Loader2 v-if="reasoningActive" class="size-3 animate-spin" />
      <span>{{ reasoningActive ? "推理中…" : "思考过程" }}</span>
      <span class="text-[var(--color-dim)]">{{ reasoningDuration }}</span>
      <ChevronDown
        class="size-3 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-enter)]"
        :class="reasoningOpen ? 'rotate-180' : ''"
      />
    </button>
    <pre
      v-if="reasoningOpen && message.reasoning"
      class="mb-2 max-h-60 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-side-glass)] p-2.5 px-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-mut)]"
    >{{ message.reasoning }}</pre>

    <div v-if="message.content" class="md-content m-0 whitespace-pre-wrap break-words" v-html="contentHtml" />
    <p v-else-if="!message.reasoning" class="m-0 break-words text-[var(--color-mut)]">
      正在思考…
    </p>
  </div>
</template>
