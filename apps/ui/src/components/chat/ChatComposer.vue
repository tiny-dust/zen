<script setup lang="ts">
import {
  ArrowUp,
  Gauge,
  Play,
  Plus,
  Sparkles,
  Square,
  Wrench,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";

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
import PromptPicker from "@/components/chat/PromptPicker.vue";
import WorkspacePicker from "@/components/chat/WorkspacePicker.vue";
import ComposerBranchPicker from "@/components/chat/ComposerBranchPicker.vue";
import QueuedMessages from "@/components/chat/QueuedMessages.vue";
import SkillUsageTags from "@/components/chat/SkillUsageTags.vue";
import { Button } from "@/components/ui/button";
import { useComposerFiles } from "@/composables/useComposerFiles";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ReasoningEffort } from "@zen/shared";

const chatStore = useChatStore();
const {
  input,
  isRunning,
  isPaused,
  canSend,
  effort,
  attachments,
  elementMarks,
  sessionWorkspaceId,
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

/** 运行中输入框不再禁用：发送即插入队列，占位文案说明当前行为 */
const composerPlaceholder = computed(() =>
  isRunning.value
    ? "Agent 运行中：输入内容按 Enter 插入队列，当前任务结束后自动执行"
    : "描述任务，/ 调用技能，# 引用 MCP 工具；标注页面元素会以 tag 插入，悬浮可看明细",
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
    <div class="relative mx-auto max-w-[860px]">
      <!-- Agent 提问卡：贴在输入框上方，回答动作紧邻输入位置 -->
      <AskUserCard v-if="chatStore.pendingAsk" class="mb-2" />

      <!-- 本会话调用感知：Agent 用了哪些技能 / MCP 服务，弹出动效 tag -->
      <SkillUsageTags />

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
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @paste="onPaste"
      >
        <label class="sr-only" for="chat-input">消息输入</label>
        <!-- 编辑插入（分叉）提示：发送后从被编辑消息处替换其后旧分支 -->
        <div
          v-if="editAnchorId"
          class="mb-1.5 flex items-center gap-2 rounded-lg bg-[var(--color-menu-active)] px-2 py-1 text-[11px] text-[var(--color-txt)]"
        >
          <span class="min-w-0 flex-1 truncate">插入对话：发送后将从该消息处分叉，其后旧内容被替换</span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none rounded-md text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
            aria-label="取消插入编辑"
            title="取消"
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
          :placeholder="composerPlaceholder"
          @update:model-value="onModelValue"
          @token-hover="onTokenHover"
          @keydown="onKeydown"
          @click="triggers.evaluate"
        />

        <div
          ref="bottomBarEl"
          class="mt-2 flex items-center justify-between gap-2"
        >
          <div class="flex min-w-0 items-center gap-1">
            <input ref="fileInputEl" type="file" multiple class="hidden" @change="onPickFiles" />
            <Button
              variant="ghost"
              size="icon-sm"
              class="flex-none text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              aria-label="添加文件"
              title="添加文件（也可直接粘贴文件/图像）"
              @click="openFilePicker"
            >
              <Plus class="size-4" />
            </Button>
            <WorkspacePicker :compact="isCompactBar" />
            <PromptPicker :compact="isCompactBar" />
            <ComposerBranchPicker :compact="isCompactBar" />
          </div>

          <div class="flex flex-none items-center gap-1">
            <!-- 上下文用量：真实 usage 优先、本地估算兜底；悬浮看两种口径明细 -->
            <div
              v-if="chatStore.contextUsage != null"
              class="flex flex-none items-center gap-1 px-1 font-[family-name:var(--font-mono)] text-[11px]"
              :class="
                (chatStore.contextUsage ?? 0) >= 80
                  ? 'text-[var(--color-err)]'
                  : 'text-[var(--color-mut)]'
              "
              :title="chatStore.contextUsageTitle"
              role="status"
              aria-label="上下文用量"
            >
              <Gauge class="size-3.5" aria-hidden="true" />
              <span>{{ chatStore.contextUsage }}%</span>
            </div>
            <EffortSlider
              v-if="selectedSupportsReasoning && !isCompactBar"
              v-model="effort"
              :allowed="allowedEfforts"
            />
            <ModelPicker :compact="isCompactBar" />
            <PermissionPicker :compact="isCompactBar" />
            <!-- 发送按钮位即运行状态位：运行中变停止，暂停时变继续 -->
            <Button
              v-if="isRunning || isPaused"
              variant="ghost"
              class="flex size-[30px] items-center justify-center rounded-full bg-[var(--color-send-empty)] text-[var(--color-send-fg)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
              :aria-label="isPaused ? '继续' : '停止'"
              :title="isPaused ? '继续' : '停止'"
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
              aria-label="发送"
              @click="chatStore.send()"
            >
              <ArrowUp class="size-4" />
            </Button>
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
            已上传
          </span>
          <span v-if="item.icon === 'skill'" class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
            {{ item.desc }}
          </span>
        </Button>
        <div v-if="!triggers.items.value.length" class="px-2.5 py-2 text-[12px] text-[var(--color-mut)]">
          {{ triggers.kind.value === "mcp" ? "没有运行中的 MCP 服务（侧栏 MCP 弹窗可配置）" : "无匹配项" }}
        </div>
      </div>
    </div>
  </div>
</template>
