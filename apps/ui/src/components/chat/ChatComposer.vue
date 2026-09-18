<script setup lang="ts">
import {
  Plus,
  ArrowUp,
  CornerDownLeft,
  FileText,
  Mic,
  Play,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import {
  Attachment,
  Attachments,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
} from "@/components/ai-elements/attachments";
import ComposerEditor from "@/components/chat/ComposerEditor.vue";
import EffortSlider from "@/components/chat/EffortSlider.vue";
import ModelPicker from "@/components/chat/ModelPicker.vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
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
  selectedSkills,
  sessionWorkspaceId,
} = storeToRefs(chatStore);
const { selectedSupportsReasoning, selectedReasoningEfforts } = storeToRefs(modelsStore);
const { permissionMode, permissionLabel } = storeToRefs(agentStore);

const loggedIn = computed(() => userStore.auth.loggedIn);

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
  onSelectSkill: (item) => {
    if (item.icon !== "skill") {
      return false;
    }
    chatStore.addSkill({
      name: item.label,
      description: item.desc,
      dir: item.dir,
      source: item.source,
    });
    return true;
  },
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
  for (const file of Array.from(target.files ?? [])) {
    const path = zen ? zen.pathForFile(file) : "";
    chatStore.addAttachment(file, path);
    editorRef.value?.insertAtCaret(`$${file.name} `);
  }
  target.value = "";
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
    chatStore.addAttachment(file, path);
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
          class="max-w-[240px] bg-[var(--color-side-glass)]"
          :class="
            hoveredAttachmentId === att.id
              ? 'border-[var(--color-accent)]'
              : 'border-[var(--color-line)]'
          "
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
      >
        <!-- 选中的技能：tag 形式渲染，悬浮展示技能信息 -->
        <div
          v-if="selectedSkills.length"
          class="mb-1.5 flex flex-wrap items-center gap-1.5"
          aria-label="已选技能"
        >
          <span
            v-for="skill in selectedSkills"
            :key="skill.name"
            class="inline-flex max-w-[240px] items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-side-glass)] py-1 pl-2 pr-1 text-[11.5px] text-[var(--color-txt-strong)]"
          >
            <HoverCard>
              <HoverCardTrigger as-child>
                <span class="inline-flex min-w-0 cursor-default items-center gap-1">
                  <Sparkles class="size-3 shrink-0 text-[var(--color-mut)]" />
                  <span class="truncate">{{ skill.name }}</span>
                </span>
              </HoverCardTrigger>
              <HoverCardContent :side="'top'" class="w-72">
                <div class="flex items-center gap-1.5">
                  <Sparkles class="size-3.5 shrink-0 text-[var(--color-mut)]" />
                  <p class="m-0 text-[12.5px] font-medium text-[var(--color-txt-strong)]">
                    {{ skill.name }}
                  </p>
                </div>
                <p class="m-0 mt-1 text-[11px] leading-relaxed text-[var(--color-mut)]">
                  {{ skill.description || "暂无描述" }}
                </p>
                <p
                  v-if="skill.dir"
                  class="m-0 mt-1.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
                  :title="skill.dir"
                >
                  {{ skill.dir }}
                </p>
              </HoverCardContent>
            </HoverCard>
            <button
              type="button"
              class="flex size-4 flex-none items-center justify-center rounded text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              aria-label="移除技能"
              @click="chatStore.removeSkill(skill.name)"
            >
              <X class="size-3" />
            </button>
          </span>
        </div>

        <label class="sr-only" for="chat-input">消息输入</label>
        <ComposerEditor
          id="chat-input"
          ref="editorRef"
          :model-value="input"
          :attachments="attachments"
          placeholder="描述任务，/ 调用技能，@ 引用文件"
          :disabled="isRunning"
          @update:model-value="onModelValue"
          @token-hover="onTokenHover"
          @keydown="onKeydown"
          @click="triggers.evaluate"
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
            <!-- 权限模式下拉：展示全部可选权限及其说明 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 items-center gap-1 rounded-lg px-2 text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
                  aria-label="选择权限模式"
                  :title="`权限：${permissionLabel}`"
                >
                  <ShieldCheck class="size-4" />
                  <span class="text-[11px]">{{ permissionLabel }}</span>
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
