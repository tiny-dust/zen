<script setup lang="ts">
import {
  Plus,
  ArrowUp,
  Mic,
  Play,
  Sparkles,
  Square,
  Settings2,
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
import PermissionIcon from "@/components/brand/PermissionIcon.vue";
import PromptAgentIcon from "@/components/brand/PromptAgentIcon.vue";
import FileLabel from "@/components/files/FileLabel.vue";
import ComposerEditor from "@/components/chat/ComposerEditor.vue";
import EffortSlider from "@/components/chat/EffortSlider.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { PermissionMode, ReasoningEffort } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

const chatStore = useChatStore();
const modelsStore = useModelsStore();
const agentStore = useAgentStore();
const userStore = useUserStore();
const {
  input,
  isRunning,
  isPaused,
  canSend,
  effort,
  attachments,
  elementMarks,
  sessionWorkspaceId,
} = storeToRefs(chatStore);
const { selectedSupportsReasoning, selectedReasoningEfforts } = storeToRefs(modelsStore);
const { permissionMode, permissionLabel, settings: agentSettings, presets } = storeToRefs(agentStore);
const settingsStore = useSettingsStore();
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

const activePreset = computed(
  () => presets.value.find((item) => item.id === agentSettings.value.prompt.presetId) ?? null,
);

const activePromptName = computed(() => {
  if (agentSettings.value.prompt.presetId === "custom") {
    return "自定义";
  }
  return (
    presets.value.find((item) => item.id === agentSettings.value.prompt.presetId)?.name ??
    "Zen 默认"
  );
});

const activePromptId = computed(() => agentSettings.value.prompt.presetId || "zen-default");

async function selectPromptPreset(id: unknown) {
  if (typeof id !== "string" || !id) {
    return;
  }
  await agentStore.updateSettings({
    prompt: {
      presetId: id,
      customText: agentSettings.value.prompt.customText,
    },
  });
}

function openPromptSettings() {
  settingsStore.openSettings("prompts");
}

const permissionModes = PERMISSION_MODES;

async function setPermissionMode(mode: unknown) {
  await agentStore.updateSettings({ permissionMode: mode as PermissionMode });
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

const editorRef = ref<InstanceType<typeof ComposerEditor> | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
/** 悬浮引用 token 时高亮上方对应的附件 chip */
const hoveredAttachmentId = ref<string | null>(null);
const imageUrls = ref(new Map<string, string>());

watch(() => attachments.value.map((att) => att.id), (ids) => {
  for (const [id, url] of imageUrls.value) {
    if (!ids.includes(id)) {
      URL.revokeObjectURL(url);
      imageUrls.value.delete(id);
    }
  }
});

onBeforeUnmount(() => {
  for (const url of imageUrls.value.values()) {
    URL.revokeObjectURL(url);
  }
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

function openFilePicker() {
  fileInputEl.value?.click();
}

function addAttachment(file: File, path: string) {
  chatStore.addAttachment(file, path);
  const attachment = attachments.value.at(-1);
  if (attachment?.isImage) {
    imageUrls.value.set(attachment.id, URL.createObjectURL(file));
  }
}

function onPickFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  const zen = window.zen;
  for (const file of Array.from(target.files ?? [])) {
    const path = zen ? zen.pathForFile(file) : "";
    addAttachment(file, path);
    editorRef.value?.insertAtCaret(`$${file.name} `);
  }
  target.value = "";
}

/** 粘贴板：文本交给编辑器默认行为；文件/图像作为附件（无路径时落到 ~/.zen/cache） */
async function onPaste(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) {
    return;
  }
  const fileItems = Array.from(data.files ?? []);
  const pathItems = Array.from(data.items ?? []).filter((item) => item.kind === "file");
  const files: File[] = [];
  if (fileItems.length) {
    files.push(...fileItems);
  } else {
    for (const item of pathItems) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  if (!files.length) {
    // 纯文本：不拦截，交给 contenteditable
    return;
  }
  event.preventDefault();
  const zen = window.zen;
  for (const file of files) {
    let path = zen ? zen.pathForFile(file) : "";
    if (!path && zen?.cache?.savePaste) {
      try {
        const buffer = await file.arrayBuffer();
        const saved = await zen.cache.savePaste({
          name: file.name || (file.type.startsWith("image/") ? "pasted-image.png" : "pasted.bin"),
          mime: file.type,
          data: buffer,
        });
        if (saved.ok && saved.path) {
          path = saved.path;
        }
      } catch {
        path = "";
      }
    }
    addAttachment(file, path);
    editorRef.value?.insertAtCaret(`$${file.name} `);
  }
}

// ---------- 拖放：只接管文件；纯文本拖放不拦截，交给编辑器 beforeinput ----------

let dragDepth = 0;

function onDragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) {
    return;
  }
  dragDepth += 1;
  dragging.value = true;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dragging.value = false;
  }
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
  }
}

/** 文件落点：编辑器内按坐标插到光标处，壳内其他区域追加到末尾 */
function onDrop(event: DragEvent) {
  dragDepth = 0;
  dragging.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  const zen = window.zen;
  let refs = "";
  for (const file of files) {
    const path = zen ? zen.pathForFile(file) : "";
    addAttachment(file, path);
    refs += `$${file.name} `;
  }
  const dropped = editorRef.value?.insertAtPoint(event.clientX, event.clientY, refs) ?? false;
  if (!dropped) {
    editorRef.value?.insertAtCaret(refs);
  }
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
  <!-- 与消息区同一背板；输入面是一块深色圆角壳，内部上文本、下工具条 -->
  <div class="flex-none bg-[var(--color-main-bg)] px-4 pb-4 pt-2">
    <div class="relative mx-auto max-w-[860px]">
      <template>
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
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @paste="onPaste"
      >
        <label class="sr-only" for="chat-input">消息输入</label>
        <ComposerEditor
          id="chat-input"
          ref="editorRef"
          :model-value="input"
          :attachments="attachments"
          :elements="elementMarks"
          placeholder="描述任务，/ 调用技能；标注页面元素会以 tag 插入，悬浮可看明细"
          :disabled="isRunning"
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
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              aria-label="添加文件"
              title="添加文件（也可直接粘贴文件/图像）"
              @click="openFilePicker"
            >
              <Plus class="size-4" />
            </button>
            <!-- 系统提示词：宽屏显示名称，小屏只显示 agent icon -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="flex items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
                  :class="isCompactBar ? 'size-7 justify-center' : 'h-7 max-w-[160px] gap-1 px-1.5'"
                  aria-label="选择系统提示词风格"
                  :title="`系统提示词：${activePromptName}`"
                >
                  <PromptAgentIcon
                    :preset-id="activePromptId"
                    :name="activePromptName"
                    :size="16"
                    class="flex-none"
                  />
                  <span v-if="!isCompactBar" class="truncate text-[11px]">{{ activePromptName }}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-72">
                <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
                  系统提示词风格
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  :model-value="agentSettings.prompt.presetId"
                  @update:model-value="selectPromptPreset"
                >
                  <DropdownMenuRadioItem
                    v-for="preset in presets"
                    :key="preset.id"
                    :value="preset.id"
                    class="items-start gap-2 py-1.5"
                  >
                    <PromptAgentIcon
                      :preset-id="preset.id"
                      :name="preset.name"
                      :size="16"
                      class="mt-0.5 flex-none"
                    />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
                        {{ preset.name }}
                      </span>
                      <span class="text-[11px] leading-snug text-[var(--color-mut)]">
                        {{ preset.description }}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="custom" class="items-start gap-2 py-1.5">
                    <PromptAgentIcon
                      preset-id="custom"
                      :size="16"
                      class="mt-0.5 flex-none"
                    />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
                        自定义
                      </span>
                      <span class="text-[11px] text-[var(--color-mut)]">
                        使用设置页中的自定义提示词
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="gap-2" @select="openPromptSettings">
                  <Settings2 class="size-3.5" />
                  <span class="text-[12px]">前往设置 · 提示词</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div class="flex flex-none items-center gap-1">
            <EffortSlider
              v-if="selectedSupportsReasoning && !isCompactBar"
              v-model="effort"
              :allowed="allowedEfforts"
            />
            <ModelPicker :compact="isCompactBar" />
            <!-- 权限：宽屏文字+图标，小屏仅三态自绘 icon -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="flex items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
                  :class="isCompactBar ? 'size-7 justify-center' : 'h-7 gap-1 px-2'"
                  aria-label="选择权限模式"
                  :title="`权限：${permissionLabel}`"
                >
                  <PermissionIcon :mode="permissionMode" :size="16" class="flex-none" />
                  <span v-if="!isCompactBar" class="text-[11px]">{{ permissionLabel }}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-72">
                <DropdownMenuRadioGroup
                  :model-value="permissionMode"
                  @update:model-value="setPermissionMode"
                >
                  <DropdownMenuRadioItem
                    v-for="mode in permissionModes"
                    :key="mode.id"
                    :value="mode.id"
                    class="items-start gap-2 py-1.5"
                  >
                    <PermissionIcon
                      :mode="mode.id"
                      class="mt-0.5 size-4 flex-none"
                    />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
                        {{ mode.label }}
                      </span>
                      <span class="text-[11px] leading-relaxed text-[var(--color-mut)]">
                        {{ mode.description }}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              aria-label="语音"
              title="语音（占位）"
              disabled
            >
              <Mic class="size-4" />
            </button>
            <!-- 发送按钮位即运行状态位：运行中变停止，暂停时变继续 -->
            <button
              v-if="isRunning || isPaused"
              type="button"
              class="flex size-[30px] items-center justify-center rounded-full bg-[var(--color-send-empty)] text-[var(--color-send-fg)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
              :aria-label="isPaused ? '继续' : '停止'"
              :title="isPaused ? '继续' : '停止'"
              @click="isPaused ? chatStore.resume() : chatStore.cancel()"
            >
              <Play v-if="isPaused" class="size-4" />
              <Square v-else class="size-3.5" />
            </button>
            <button
              v-else
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
          @mousedown.prevent
          @mouseenter="triggers.active.value = index"
          @click="triggers.apply(item)"
        >
          <FileLabel
            v-if="item.icon !== 'skill'"
            :path="item.desc"
            :kind="item.icon === 'dir' ? 'directory' : 'file'"
            class="flex-1 text-[12px]"
          />
          <template v-else>
            <Sparkles class="size-3.5 shrink-0 text-[var(--color-mut)]" />
            <span class="min-w-0 truncate text-[12px]">{{ item.label }}</span>
          </template>
          <span v-if="item.icon === 'skill'" class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
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
