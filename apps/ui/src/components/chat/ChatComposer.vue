<script setup lang="ts">
import {
  Plus,
  ArrowUp,
  CornerDownLeft,
  FileText,
  Image as ImageIcon,
  Mic,
  Sparkles,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

import EffortSlider from "@/components/chat/EffortSlider.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
import { Textarea } from "@/components/ui/textarea";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ReasoningEffort } from "@zen/shared";

const chatStore = useChatStore();
const modelsStore = useModelsStore();
const {
  input,
  isRunning,
  canSend,
  effort,
  attachments,
  sessionWorkspaceId,
} = storeToRefs(chatStore);
const { selectedSupportsReasoning, selectedReasoningEfforts } = storeToRefs(modelsStore);

const allowedEfforts = computed(() => {
  const allowed = selectedReasoningEfforts.value as readonly ReasoningEffort[];
  return allowed.length
    ? allowed
    : (["minimal", "low", "medium", "high", "xhigh", "max"] as ReasoningEffort[]);
});

watch(selectedSupportsReasoning, (supports) => {
  if (!supports && effort.value !== "off") {
    effort.value = "off";
  }
});

// 模型切换后，当前档位若不在该模型配置的档位里，落到中间档
watch(allowedEfforts, (list) => {
  if (selectedSupportsReasoning.value && !list.includes(effort.value)) {
    effort.value = list[Math.floor(list.length / 2)] ?? "off";
  }
}, { immediate: true });

const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const triggers = useComposerTriggers({
  textarea: () => textareaEl.value,
  value: () => input.value,
  setValue: (next) => {
    input.value = next;
  },
  rootPath: () => useWorkspaceStore().pathOf(sessionWorkspaceId.value),
});

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }
  return `${bytes}B`;
}

function onInput() {
  triggers.evaluate();
}

function onKeydown(event: KeyboardEvent) {
  if (triggers.onKeydown(event)) {
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void chatStore.send();
  }
}

function openFilePicker() {
  fileInputEl.value?.click();
}

function onPickFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  const zen = window.zen;
  const files = Array.from(target.files ?? []);
  for (const file of files) {
    const path = zen ? zen.pathForFile(file) : "";
    chatStore.addAttachment(file, path);
    insertAtCursor(`$${file.name} `);
  }
  target.value = "";
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const zen = window.zen;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  for (const file of files) {
    const path = zen ? zen.pathForFile(file) : "";
    chatStore.addAttachment(file, path);
    insertAtCursor(`$${file.name} `);
  }
}

function insertAtCursor(text: string) {
  const el = textareaEl.value;
  const value = input.value;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  input.value = value.slice(0, start) + text + value.slice(end);
  void nextTick(() => {
    el?.focus();
    const caret = start + text.length;
    el?.setSelectionRange(caret, caret);
  });
}

function removeAttachment(id: string) {
  chatStore.removeAttachment(id);
}
</script>

<template>
  <!-- 与消息区同一背板；输入面是一块深色圆角壳，内部上文本、下工具条 -->
  <div class="flex-none bg-[var(--color-main-bg)] px-4 pb-4 pt-2">
    <div class="relative mx-auto max-w-[860px]">
      <div
        v-if="attachments.length"
        class="mb-2 flex flex-wrap gap-1.5"
      >
        <div
          v-for="att in attachments"
          :key="att.id"
          class="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-side-glass)] px-2 py-1 text-[11px]"
        >
          <ImageIcon v-if="att.isImage" class="size-[13px] shrink-0 text-[var(--color-mut)]" />
          <FileText v-else class="size-[13px] shrink-0 text-[var(--color-mut)]" />
          <span class="truncate text-[var(--color-txt-strong)]" :title="att.path">{{ att.name }}</span>
          <span class="shrink-0 text-[var(--color-dim)]">{{ formatSize(att.size) }}</span>
          <button
            type="button"
            class="inline-flex rounded text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            aria-label="移除附件"
            @click="removeAttachment(att.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <div
        class="rounded-2xl bg-[var(--color-composer-surface)] px-3 pb-2.5 pt-3 shadow-[var(--shadow-composer)]"
        :class="
          dragging
            ? 'border border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-line))]'
            : 'border border-transparent'
        "
      >
        <label class="sr-only" for="chat-input">消息输入</label>
        <Textarea
          id="chat-input"
          ref="textareaEl"
          v-model="input"
          class="max-h-[220px] min-h-[44px]! resize-none rounded-none! border-none! bg-transparent! px-0! py-0! text-[14px] leading-relaxed text-[var(--color-txt-strong)] placeholder:text-[var(--color-composer-placeholder)]"
          rows="2"
          placeholder="描述任务，输入/调用技能"
          :disabled="isRunning"
          @input="onInput"
          @keydown="onKeydown"
          @click="triggers.evaluate"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop="onDrop"
        />

        <div class="mt-2 flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1">
            <input ref="fileInputEl" type="file" multiple class="hidden" @change="onPickFiles" />
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
              aria-label="添加文件"
              title="添加文件"
              @click="openFilePicker"
            >
              <Plus class="size-4" />
            </button>
          </div>

          <div class="flex items-center gap-1.5">
            <EffortSlider
              v-if="selectedSupportsReasoning"
              v-model="effort"
              :allowed="allowedEfforts"
            />
            <ModelPicker />
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
              aria-label="语音"
              title="语音（占位）"
              disabled
            >
              <Mic class="size-4" />
            </button>
            <button
              type="button"
              class="flex size-[30px] items-center justify-center rounded-full"
              :class="
                canSend
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90'
                  : 'bg-[var(--color-send-empty)] text-[var(--color-send-fg)]'
              "
              :disabled="!canSend"
              aria-label="发送"
              @click="chatStore.send()"
            >
              <ArrowUp class="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        class="mt-1.5 flex h-4 items-center justify-center text-[11px] text-[var(--color-dim)]"
      >
        内容由 AI 生成，请注意核实
      </div>

      <div
        v-if="triggers.open.value"
        class="absolute inset-x-0 bottom-[calc(100%+6px)] z-20 max-h-[260px] overflow-auto rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] p-1.5 shadow-[var(--shadow-menu)]"
        role="listbox"
        aria-label="触发建议"
      >
        <button
          v-for="(item, index) in triggers.items.value"
          :key="item.label + item.desc"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left"
          :class="
            index === triggers.active.value
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : 'text-[var(--color-txt)]'
          "
          role="option"
          :aria-selected="index === triggers.active.value"
          @mouseenter="triggers.active.value = index"
          @click="triggers.apply(item)"
        >
          <Sparkles v-if="item.icon === 'skill'" class="size-3.5 shrink-0 text-[var(--color-mut)]" />
          <FileText
            v-else-if="item.icon === 'file'"
            class="size-3.5 shrink-0 text-[var(--color-mut)]"
          />
          <CornerDownLeft v-else class="size-3.5 shrink-0 text-[var(--color-mut)]" />
          <span class="shrink-0 text-[12px]">{{ item.label }}</span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
            {{ item.desc }}
          </span>
        </button>
        <div v-if="!triggers.items.value.length" class="px-2.5 py-2 text-[12px] text-[var(--color-mut)]">
          无匹配项
        </div>
      </div>
    </div>
  </div>
</template>
