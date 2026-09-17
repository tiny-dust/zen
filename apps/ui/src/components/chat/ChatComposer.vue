<script setup lang="ts">
import {
  Plus,
  ArrowUp,
  CornerDownLeft,
  FileText,
  Mic,
  ShieldCheck,
  Sparkles,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

import {
  Attachment,
  Attachments,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
} from "@/components/ai-elements/attachments";
import AskUserCard from "@/components/chat/AskUserCard.vue";
import EffortSlider from "@/components/chat/EffortSlider.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
import { Textarea } from "@/components/ui/textarea";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ReasoningEffort } from "@zen/shared";

const chatStore = useChatStore();
const modelsStore = useModelsStore();
const agentStore = useAgentStore();
const userStore = useUserStore();
const {
  input,
  isRunning,
  canSend,
  effort,
  attachments,
  sessionWorkspaceId,
} = storeToRefs(chatStore);
const { selectedSupportsReasoning, selectedReasoningEfforts } = storeToRefs(modelsStore);
const { permissionLabel } = storeToRefs(agentStore);

const loggedIn = computed(() => userStore.auth.loggedIn);

/** 循环切换权限档位：默认 → 智能 → 完全访问 */
async function cyclePermission() {
  const order = ["default", "smart", "full"] as const;
  const next = order[(order.indexOf(agentStore.permissionMode) + 1) % order.length];
  await agentStore.updateSettings({ permissionMode: next });
}

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

/** ComposerAttachment → ai-elements AttachmentData（媒体类型供选图标） */
function attachmentData(att: { id: string; name: string; isImage: boolean }): AttachmentData {
  return {
    id: att.id,
    type: "file",
    filename: att.name,
    url: "",
    mediaType: att.isImage ? "image/*" : "application/octet-stream",
  };
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
      <!-- askUser 提问卡：Agent 请求决策时置于输入框上方 -->
      <AskUserCard />

      <!-- 未登录拦截：本地配置保留，agent 会话需登录后使用 -->
      <div
        v-if="!loggedIn"
        class="flex items-center gap-3 rounded-2xl bg-[var(--color-composer-surface)] px-4 py-3 shadow-[var(--shadow-composer)]"
      >
        <ShieldCheck :size="16" class="flex-none text-[var(--color-mut)]" />
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[13px] font-medium text-[var(--color-txt-strong)]">
            登录后开始使用
          </p>
          <p class="m-0 mt-0.5 text-[11.5px] text-[var(--color-mut)]">
            本地配置与模型设置已保留；登录 GitHub 后即可对话与执行任务。
          </p>
        </div>
        <button
          type="button"
          class="flex-none rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
          @click="userStore.login()"
        >
          {{ userStore.loading ? "等待授权…" : "登录 GitHub" }}
        </button>
      </div>

      <template v-else>
      <!-- 附件列表（ai-elements inline 变体）：在输入面上方一行文件 chip -->
      <Attachments v-if="attachments.length" variant="inline" class="mb-2">
        <Attachment
          v-for="att in attachments"
          :key="att.id"
          :data="attachmentData(att)"
          class="max-w-[240px] bg-[var(--color-side-glass)] border-[var(--color-line)]"
          @remove="removeAttachment(att.id)"
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <span class="shrink-0 text-[10.5px] text-[var(--color-dim)]">
            {{ formatSize(att.size) }}
          </span>
          <AttachmentRemove label="移除附件" class="hover:bg-transparent!" />
        </Attachment>
      </Attachments>

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
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
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
              class="flex h-7 items-center gap-1 rounded-lg px-2 text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
              aria-label="切换权限模式"
              :title="`权限：${permissionLabel}（点击切换）`"
              @click="cyclePermission"
            >
              <ShieldCheck class="size-4" />
              <span class="text-[11px]">{{ permissionLabel }}</span>
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
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
      </template>

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
