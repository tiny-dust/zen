<script setup lang="ts">
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  Play,
  Plus,
  Sparkles,
  Square,
  TriangleAlert,
  Wrench,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  Attachment,
  Attachments,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
} from "@/components/ai-elements/attachments";
import FileLabel from "@/components/files/FileLabel.vue";
import ComposerEditor from "@/components/chat/ComposerEditor.vue";
import AskUserCard from "@/components/chat/AskUserCard.vue";
import EffortSlider from "@/components/chat/EffortSlider.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
import PermissionPicker from "@/components/chat/PermissionPicker.vue";
import SessionModePicker from "@/components/chat/SessionModePicker.vue";
import PromptPicker from "@/components/chat/PromptPicker.vue";
import WorkspacePicker from "@/components/chat/WorkspacePicker.vue";
import ComposerBranchPicker from "@/components/chat/ComposerBranchPicker.vue";
import ContextUsagePicker from "@/components/chat/ContextUsagePicker.vue";
import GoalChip from "@/components/chat/GoalChip.vue";
import QueuedMessages from "@/components/chat/QueuedMessages.vue";
import SkillUsageTags from "@/components/chat/SkillUsageTags.vue";
import { Button } from "@/components/ui/button";
import { useComposerFiles } from "@/composables/useComposerFiles";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { useVoiceInput } from "@/composables/useSystemAbilities";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ReasoningEffort } from "@zen/shared";

const { t } = useI18n();
const chatStore = useChatStore();
const {
  input,
  isRunning,
  isPreparing,
  isPaused,
  canSend,
  effort,
  attachments,
  elementMarks,
  sessionWorkspaceId,
  sessionMode,
  queuedMessages,
  editAnchorId,
} = storeToRefs(chatStore);
const { effectiveModel } = storeToRefs(chatStore);
// 推理档位跟随当前会话生效模型（会话级覆盖优先）
const selectedSupportsReasoning = computed(() =>
  Boolean(effectiveModel.value?.model.capabilities?.reasoning),
);
const selectedReasoningEfforts = computed<ReasoningEffort[]>(() => {
  const efforts = effectiveModel.value?.model.capabilities?.reasoningEfforts;
  if (efforts?.length) {
    return [...efforts];
  }
  if (effectiveModel.value?.model.capabilities?.reasoning) {
    return ["low", "medium", "high"];
  }
  return [];
});
const viewportCompact = useMediaQuery("(max-width: 1024px)");
const advancedOpen = ref(false);
/** 底栏实际宽度：比视口更准——侧栏/右栏占用后 composer 变窄也要收成 icon */
const bottomBarEl = ref<HTMLElement | null>(null);
const bottomBarWidth = ref(0);
let barResizeObserver: ResizeObserver | null = null;

watch(
  bottomBarEl,
  (el) => {
    barResizeObserver?.disconnect();
    barResizeObserver = null;
    bottomBarWidth.value = el?.clientWidth ?? 0;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    barResizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth ?? 0;
      bottomBarWidth.value = width;
    });
    barResizeObserver.observe(el);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  barResizeObserver?.disconnect();
  barResizeObserver = null;
});

/** 小屏/窄底栏：权限、模型、提示词只显示 icon */
const isCompactBar = computed(() => {
  if (viewportCompact.value) {
    return true;
  }
  return bottomBarWidth.value > 0 && bottomBarWidth.value < 720;
});

/** 运行中输入框不再禁用：发送即插入队列（当前任务结束后自动执行），占位文案说明当前行为 */
const composerPlaceholder = computed(() =>
  isRunning.value
    ? t("chat.placeholderRunning")
    : t("chat.placeholderIdle"),
);

/** 计划模式批准按钮：计划产出后（最后一条是 assistant）且空闲时显示 */
const showPlanApproval = computed(
  () =>
    sessionMode.value === "plan" &&
    !isRunning.value &&
    !isPaused.value &&
    chatStore.messages.at(-1)?.role === "assistant",
);

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

const editorRef = ref<InstanceType<typeof ComposerEditor> | null>(null);
/** 悬浮引用 token 时高亮上方对应的附件 chip */
const hoveredAttachmentId = ref<string | null>(null);

// 语音输入（平台不支持时按钮隐藏；点击开始 → 再点结束 → 转写插入光标处）
const {
  supported: voiceSupported,
  recording: voiceRecording,
  transcribing: voiceTranscribing,
  partialText: voicePartial,
  toggle: toggleVoice,
} = useVoiceInput();

/** macOS 麦克风/语音识别授权被拒的特征文案（Swift 工具 stderr 透传） */
const MIC_PERMISSION_DENIED = /microphone permission|speech recognizer|permission denied|麦克风|权限/i;
/** 权限引导横幅：关闭后本次会话内不再弹（重新触发错误会再展示） */
const voicePermHint = ref(false);

/** macOS 麦克风授权面板深链（TCC Privacy_Microphone；语音识别在同面板相邻项） */
function openMicSettings() {
  void window.zen?.app.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  );
}

async function onMicClick() {
  try {
    const text = await toggleVoice();
    if (text) {
      editorRef.value?.insertAtCaret(text);
      editorRef.value?.focus();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // macOS 权限被拒（麦克风 / 语音识别）：展示授权引导横幅而不是只报错
    if (MIC_PERMISSION_DENIED.test(message)) {
      voicePermHint.value = true;
      return;
    }
    chatStore.statusText =
      message && message !== "EMPTY" ? message : t("system-abilities.voice.emptyResult");
  }
}

// 文件进入通道（选择/粘贴/拖放）与附件 objectURL 生命周期拆到 composable
const {
  dragging,
  fileInputEl,
  imageUrls,
  openFilePicker,
  onPickFiles,
  onPaste,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
} = useComposerFiles({
  attachments,
  insertAtCaret: (text) => {
    editorRef.value?.insertAtCaret(text);
  },
  insertAtPoint: (x, y, refs) => editorRef.value?.insertAtPoint(x, y, refs) ?? false,
});

const triggers = useComposerTriggers({
  caret: () => editorRef.value?.caretOffset() ?? 0,
  value: () => input.value,
  setValue: (next) => {
    input.value = next;
  },
  setCaret: (offset) => {
    editorRef.value?.setCaretSoon(offset);
  },
  focus: () => {
    editorRef.value?.focus();
  },
  rootPath: () => useWorkspaceStore().pathOf(sessionWorkspaceId.value),
  // 本会话上传过的文件（当前附件 + 历史消息附件）：@ 弹层置顶可搜
  uploadedFiles: () => chatStore.sessionUploadedFiles,
  registerUploaded: (file) => chatStore.registerAttachmentRef(file),
});

// 浏览器「标注」等：写入 composer 光标处
watch(
  () => chatStore.pendingComposerInsert,
  (item) => {
    if (!item?.text) {
      return;
    }
    editorRef.value?.insertAtCaret(item.text);
    editorRef.value?.focus();
    chatStore.pendingComposerInsert = null;
  },
  { deep: true },
);

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
function attachmentData(att: { id: string; name: string; path: string; isImage: boolean }): AttachmentData {
  return {
    id: att.id,
    type: "file",
    filename: att.name,
    path: att.path,
    url: imageUrls.value.get(att.id) ?? "",
    mediaType: att.isImage ? "image/*" : "application/octet-stream",
  };
}

function onModelValue(value: string) {
  input.value = value;
  triggers.evaluate();
}

function onKeydown(event: KeyboardEvent) {
  if (triggers.onKeydown(event)) {
    return;
  }
  if (event.isComposing) {
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  // Cmd/Ctrl+Enter：换行（与 Shift+Enter 同语义）
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    editorRef.value?.insertAtCaret("\n");
    return;
  }
  if (!event.shiftKey) {
    event.preventDefault();
    void chatStore.send();
  }
  // Shift+Enter 不拦截：交给编辑器 beforeinput 的 insertParagraph 换行
}

/** 悬浮正文引用 token 时高亮上方对应附件 chip */
function onTokenHover(id: string | null) {
  hoveredAttachmentId.value = id;
}

function removeAttachment(id: string) {
  const att = attachments.value.find((item) => item.id === id);
  chatStore.removeAttachment(id);
  if (att && input.value.includes(`$${att.name}`)) {
    input.value = input.value.split(`$${att.name}`).join("");
  }
}
</script>

<template>
  <!-- 与消息区同一背板；输入面是一块深色圆角壳，内部上文本、下工具条。
       左侧与消息区共用 --chat-gutter 引导线槽，保持两列对齐（见 styles.css） -->
  <div class="flex-none bg-[var(--color-main-bg)] pl-[var(--chat-gutter)] pr-4 pb-4 pt-2">
    <div class="relative mx-auto max-w-[1024px]">
      <!-- Agent 提问卡：贴在输入框上方，回答动作紧邻输入位置 -->
      <AskUserCard v-if="chatStore.pendingAsk" class="mb-2" />

      <!-- 本会话调用感知：Agent 用了哪些技能 / MCP 服务，弹出动效 tag -->
      <SkillUsageTags />

      <!-- 语音授权引导（macOS 拒绝麦克风/识别授权时）：报错旁直接给系统设置入口 -->
      <div
        v-if="voicePermHint"
        class="mb-2 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warn,#d97709)_35%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="flex-none text-[var(--color-warn,#d97709)]" />
        <span class="min-w-0 flex-1">{{ t("system-abilities.voice.micDenied") }}</span>
        <Button variant="outline" size="sm" class="flex-none" @click="openMicSettings">
          {{ t("system-abilities.voice.openSettings") }}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none rounded-md hover:text-[var(--color-txt-strong)]"
          :aria-label="t('common.close')"
          @click="voicePermHint = false"
        >
          <X :size="13" />
        </Button>
      </div>

      <!-- 语音实时字幕：录音期间识别器 partial 结果实时上屏，说完即所见 -->
      <div
        v-if="voiceRecording"
        class="mb-2 flex min-h-[34px] items-center gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] px-3 py-2 text-[13px] text-[var(--color-txt)]"
        role="status"
        :aria-label="t('system-abilities.voice.listening')"
      >
        <span class="relative flex size-2.5 flex-none">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
          <span class="relative inline-flex size-2.5 rounded-full bg-[var(--color-accent)]" />
        </span>
        <span class="min-w-0 flex-1 break-words text-[var(--color-txt)]">
          {{ voicePartial || t("system-abilities.voice.listening") }}
        </span>
        <span
          v-if="voiceTranscribing"
          class="flex-none text-[11px] text-[var(--color-mut)]"
        >
          {{ t("system-abilities.voice.transcribing") }}
        </span>
      </div>

      <!-- 附件列表（ai-elements inline 变体）：在输入面上方一行文件 chip -->
      <Attachments v-if="attachments.length" variant="inline" class="mb-2">
        <Attachment
          v-for="att in attachments"
          :key="att.id"
          :data="attachmentData(att)"
          class="max-w-[240px]"
          :class="hoveredAttachmentId === att.id ? 'text-[var(--color-accent)]' : ''"
          @remove="removeAttachment(att.id)"
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <span class="shrink-0 text-[10px] text-[var(--color-dim)]">
            {{ formatSize(att.size) }}
          </span>
          <AttachmentRemove :label="t('chat.removeAttachment')" class="hover:bg-transparent!" />
        </Attachment>
      </Attachments>

      <div
        class="rounded-2xl bg-[var(--color-composer-surface)] px-3 pb-2.5 pt-3 shadow-[var(--shadow-composer)]"
        :class="
          dragging
            ? 'border border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-line))]'
            : 'border border-transparent'
        "
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @paste="onPaste"
      >
        <label class="sr-only" for="chat-input">{{ t("chat.messageInput") }}</label>
        <!-- 编辑插入（分叉）提示：发送后从被编辑消息处替换其后旧分支 -->
        <div
          v-if="editAnchorId"
          class="mb-1.5 flex items-center gap-2 rounded-lg bg-[var(--color-menu-active)] px-2 py-1 text-[11px] text-[var(--color-txt)]"
        >
          <span class="min-w-0 flex-1 truncate">{{ t("chat.insertEditHint") }}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none rounded-md text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('chat.cancelInsertEdit')"
            :title="t('common.cancel')"
            @click="chatStore.cancelEdit()"
          >
            <X class="size-3" />
          </Button>
        </div>
        <QueuedMessages
          :items="queuedMessages"
          :insert-disabled="chatStore.insertActive"
          @promote="chatStore.promoteQueued"
          @edit="chatStore.editQueued"
          @remove="chatStore.removeQueued"
          @insert="chatStore.insertQueued"
        />
        <ComposerEditor
          id="chat-input"
          ref="editorRef"
          :model-value="input"
          :attachments="attachments"
          :elements="elementMarks"
          :mention-exclude="triggers.activeTokenRange.value"
          :placeholder="composerPlaceholder"
          @update:model-value="onModelValue"
          @token-hover="onTokenHover"
          @keydown="onKeydown"
          @click="triggers.evaluate"
        />

        <!-- 核心发送操作常驻；模式、权限等会话设置按需展开。 -->
        <div ref="bottomBarEl" class="mt-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1">
              <input ref="fileInputEl" type="file" multiple class="hidden" @change="onPickFiles" />
              <Button
                variant="ghost"
                size="icon-sm"
                class="flex-none text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
                :aria-label="t('chat.addFile')"
                :title="t('chat.addFileTitle')"
                @click="openFilePicker"
              >
                <Plus class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1 text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
                :aria-expanded="advancedOpen"
                aria-controls="composer-advanced-options"
                @click="advancedOpen = !advancedOpen"
              >
                {{ t("chat.moreOptions") }}
                <ChevronDown class="size-3.5 transition-transform" :class="advancedOpen ? 'rotate-180' : ''" />
              </Button>
            </div>

            <div class="flex flex-none items-center gap-1">
              <ModelPicker :compact="isCompactBar" />
              <!-- 语音输入：平台不支持时隐藏；录音中变停止（点击结束并转写） -->
              <Button
                v-if="voiceSupported"
                variant="ghost"
                size="icon-sm"
                class="flex-none transition-colors"
                :class="
                  voiceRecording
                    ? 'text-[var(--color-accent)] hover:text-[var(--color-accent)]'
                    : 'text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]'
                "
                :disabled="voiceTranscribing"
                :aria-label="voiceRecording ? t('system-abilities.voice.stop') : t('system-abilities.voice.start')"
                :title="voiceRecording ? t('system-abilities.voice.stopTitle') : t('system-abilities.voice.startTitle')"
                @click="onMicClick"
              >
                <Square v-if="voiceRecording" class="size-3.5" />
                <Mic v-else class="size-4" />
              </Button>
              <!-- 计划模式批准：以「批准执行」消息继续，main 侧切回互动模式 -->
              <Button
                v-if="showPlanApproval"
                variant="ghost"
                class="h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
                :aria-label="t('session-mode.sessionMode.plan.approve')"
                :title="t('session-mode.sessionMode.plan.approveTitle')"
                @click="chatStore.approvePlan()"
              >
                <Check class="size-3.5" aria-hidden="true" />
                {{ t("session-mode.sessionMode.plan.approve") }}
              </Button>
              <!-- 发送按钮位即运行状态位：运行中变停止，暂停时变继续 -->
              <Button
                v-if="isRunning || isPaused"
                variant="ghost"
                class="flex size-[30px] items-center justify-center rounded-full bg-[var(--color-send-empty)] text-[var(--color-send-fg)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
                :aria-label="isPaused ? t('chat.resume') : t('chat.stop')"
                :title="isPaused ? t('chat.resume') : t('chat.stop')"
                @click="isPaused ? chatStore.resume() : chatStore.cancel()"
              >
                <Play v-if="isPaused" class="size-4" />
                <Square v-else class="size-3.5" />
              </Button>
              <Button
                v-else
                variant="ghost"
                class="flex size-[30px] items-center justify-center rounded-full disabled:opacity-45"
                :class="
                  canSend
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90'
                    : 'bg-[var(--color-send-empty)] text-[var(--color-send-fg)]'
                "
                :disabled="!canSend"
                :aria-label="isPreparing ? t('chat.bubble.thinking') : t('chat.send')"
                @click="chatStore.send()"
              >
                <LoaderCircle v-if="isPreparing" class="size-4 animate-spin" />
                <ArrowUp v-else class="size-4" />
              </Button>
            </div>
          </div>

          <!-- 展开后按任务配置和环境信息分组。 -->
          <div
            v-if="advancedOpen"
            id="composer-advanced-options"
            class="flex min-w-0 flex-wrap items-center justify-between gap-1 border-t border-[var(--color-line-soft)] pt-1.5"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-1">
              <PromptPicker :compact="isCompactBar" />
              <SessionModePicker :compact="isCompactBar" />
              <EffortSlider
                v-if="selectedSupportsReasoning"
                v-model="effort"
                :allowed="allowedEfforts"
              />
              <WorkspacePicker :compact="isCompactBar" />
              <ComposerBranchPicker :compact="isCompactBar" />
              <!-- 会话目标（Goals 目标模式）：无目标=设定入口，有目标=摘要 chip -->
              <GoalChip />
            </div>
            <div class="flex flex-none items-center gap-1">
              <PermissionPicker :compact="isCompactBar" />
              <ContextUsagePicker :compact="isCompactBar" />
            </div>
          </div>
        </div>
      </div>

      <div
        class="mt-1.5 flex h-4 items-center justify-center text-[11px] text-[var(--color-dim)]"
      >
        {{ t("chat.aiDisclaimer") }}
      </div>

      <div
        v-if="triggers.open.value"
        class="absolute inset-x-0 bottom-[calc(100%+6px)] z-20 max-h-[260px] overflow-auto rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] p-1.5 shadow-[var(--shadow-menu)]"
        role="listbox"
        :aria-label="t('chat.triggerSuggestions')"
      >
        <Button
          v-for="(item, index) in triggers.items.value"
          :key="item.label + item.desc"
          variant="ghost"
          class="flex w-full items-center justify-start gap-2 rounded-lg px-2.5 py-2 text-left font-normal"
          :class="
            index === triggers.active.value
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : 'text-[var(--color-txt)]'
          "
          role="option"
          :aria-selected="index === triggers.active.value"
          @mousedown.prevent
          @mouseenter="triggers.active.value = index"
          @click="triggers.apply(item)"
        >
          <FileLabel
            v-if="item.icon === 'file' || item.icon === 'dir'"
            :path="item.desc"
            :kind="item.icon === 'dir' ? 'directory' : 'file'"
            class="flex-1 text-[12px]"
          />
          <template v-else-if="item.icon === 'mcp'">
            <Wrench class="size-3.5 shrink-0 text-[var(--color-mut)]" />
            <span class="min-w-0 truncate text-[12px]">{{ item.label }}</span>
            <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
              {{ item.desc }}
            </span>
          </template>
          <template v-else>
            <Sparkles class="size-3.5 shrink-0 text-[var(--color-mut)]" />
            <span class="min-w-0 truncate text-[12px]">{{ item.label }}</span>
          </template>
          <span
            v-if="item.uploaded"
            class="shrink-0 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] leading-4 text-[var(--color-dim)]"
          >
            {{ t("chat.uploaded") }}
          </span>
          <span v-if="item.icon === 'skill'" class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
            {{ item.desc }}
          </span>
        </Button>
        <div v-if="!triggers.items.value.length" class="px-2.5 py-2 text-[12px] text-[var(--color-mut)]">
          {{ triggers.kind.value === "mcp" ? t("chat.noMcpRunning") : t("chat.noMatch") }}
        </div>
      </div>
    </div>
  </div>
</template>
