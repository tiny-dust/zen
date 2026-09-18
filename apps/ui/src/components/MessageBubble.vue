<script setup lang="ts">
import { Ban, Check, CircleAlert, Copy, Pencil, Sparkles, TriangleAlert } from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";

import { Loader } from "@/components/ai-elements/loader";
import {
  Attachment,
  Attachments,
  AttachmentInfo,
  AttachmentPreview,
} from "@/components/ai-elements/attachments";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import ToolCallCard from "@/components/chat/ToolCallCard.vue";
import ToolCallRow from "@/components/chat/ToolCallRow.vue";
import { useChatStore } from "@/stores/chat";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { SelectedSkill } from "@/stores/chat-types";
import type {
  ChatMessage,
  ChatMessagePart,
  ChatRunSummary,
  ToolCallMessageMeta,
} from "@zen/shared";
import { getMessageRun } from "@zen/shared";

const props = defineProps<{
  message: ChatMessage;
  streaming?: boolean;
}>();

const chatStore = useChatStore();

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

/** 消息附件只有文件名：按扩展名给出媒体类型，供附件组件挑图标 */
function mediaTypeOf(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return IMAGE_EXT.has(ext) ? `image/${ext === "jpg" ? "jpeg" : ext}` : "application/octet-stream";
}

/** 按时间顺序的分段：新消息用 parts，旧消息按「思考 → 正文」合成 */
const parts = computed<ChatMessagePart[]>(() => {
  if (props.message.parts?.length) {
    return props.message.parts;
  }
  const legacy: ChatMessagePart[] = [];
  if (props.message.reasoning) {
    legacy.push({
      type: "reasoning",
      text: props.message.reasoning,
      ms: props.message.reasoningMs,
    });
  }
  if (props.message.content) {
    legacy.push({ type: "text", text: props.message.content });
  }
  return legacy;
});

/** 分段后是否还有正文/工具：决定思考块默认展开与自动收起 */
function hasTextAfter(index: number): boolean {
  return parts.value.slice(index + 1).some((part) => part.type === "text" || part.type === "tool");
}

/** 思考块流式进行中：未显式 done，且仍是流式消息的最后一段 reasoning */
function reasoningStreaming(index: number): boolean {
  const part = parts.value[index];
  if (part?.type !== "reasoning") {
    return false;
  }
  if (part.done === true) {
    return false;
  }
  if (part.done === false) {
    return props.streaming === true;
  }
  return props.streaming === true && index === parts.value.length - 1;
}

const reasoningSeconds = (part: Extract<ChatMessagePart, { type: "reasoning" }>) =>
  part.ms ? Math.ceil(part.ms / 1000) : undefined;

const attachmentParts = computed<AttachmentData[]>(() => {
  const meta = props.message.meta as { attachments?: Array<{ name: string }> } | undefined;
  return (meta?.attachments ?? []).map((att, index) => ({
    id: `${att.name}-${index}`,
    type: "file" as const,
    filename: att.name,
    url: "",
    mediaType: mediaTypeOf(att.name),
  }));
});

const toolMeta = computed<ToolCallMessageMeta | null>(() => {
  if (props.message.role !== "tool") {
    return null;
  }
  const meta = props.message.meta as Partial<ToolCallMessageMeta> | undefined;
  if (!meta?.toolName) {
    return null;
  }
  return {
    toolName: meta.toolName,
    ok: meta.ok !== false,
    summary: meta.summary ?? props.message.content,
    output: meta.output,
    args: meta.args,
    state: meta.state,
    message: meta.message,
    percent: meta.percent,
  };
});

/** 发送时随消息一起带上的技能 tag（正文不含 /skill: 前缀） */
const skillParts = computed<SelectedSkill[]>(() => {
  const meta = props.message.meta as { skills?: SelectedSkill[] } | undefined;
  return meta?.skills ?? [];
});

/** 当前助手消息的 run 终态（历史 meta.run 优先；流式中对齐 store） */
const runSummary = computed<ChatRunSummary | null>(() => {
  if (props.message.role !== "assistant") {
    return null;
  }
  const fromMeta = getMessageRun(props.message);
  if (fromMeta) {
    return fromMeta;
  }
  if (props.streaming) {
    return chatStore.runSummary;
  }
  return null;
});

type RunBanner = {
  label: string;
  tone: "ok" | "err" | "warn" | "mut";
  icon: typeof Check;
  detail?: string;
};

const runBanner = computed<RunBanner | null>(() => {
  const summary = runSummary.value;
  if (!summary || props.streaming) {
    return null;
  }
  const reason = summary.reason;
  if (!reason || reason === "stop") {
    return null;
  }
  if (reason === "cancelled") {
    return {
      label: "已取消",
      tone: "warn",
      icon: Ban,
      detail: "本次运行被中断，工具与正文可能不完整",
    };
  }
  if (reason === "error") {
    return {
      label: "运行失败",
      tone: "err",
      icon: CircleAlert,
      detail: summary.error || "请查看错误信息后重试",
    };
  }
  return {
    label: "已达到步骤上限",
    tone: "warn",
    icon: TriangleAlert,
    detail: summary.step != null ? `共 ${summary.step} 步` : undefined,
  };
});

const runToneClass = computed(() => {
  switch (runBanner.value?.tone) {
    case "err":
      return "text-[var(--color-danger-fg)]";
    case "warn":
      return "text-[var(--color-accent-2)]";
    case "ok":
      return "text-[var(--color-ok)]";
    default:
      return "text-[var(--color-mut)]";
  }
});

/** system 消息：默认中性通知；meta.severity=danger 才用危险红 */
const systemTone = computed(() => {
  const meta = props.message.meta as { severity?: string; kind?: string } | undefined;
  if (meta?.severity === "danger" || meta?.kind === "error") {
    return "danger" as const;
  }
  return "neutral" as const;
});

/** 发送时间：今天只显示时分，更早的带日期 */
function formatTime(ts: number): string {
  const date = new Date(ts);
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? hm
    : `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

const copied = ref(false);

/** 流式运行时长：每秒跳动的已运行时间，让用户知道回复仍在进行 */
const elapsedText = ref("");
let elapsedTimer: number | undefined;

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function stopElapsedTimer() {
  if (elapsedTimer !== undefined) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
}

watch(
  () => props.streaming,
  (active) => {
    stopElapsedTimer();
    if (!active) {
      elapsedText.value = "";
      return;
    }
    const startedAt = chatStore.runStartedAt ?? Date.now();
    const tick = () => {
      elapsedText.value = formatElapsed(Date.now() - startedAt);
    };
    tick();
    elapsedTimer = window.setInterval(tick, 1000);
  },
  { immediate: true },
);

onUnmounted(stopElapsedTimer);

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    chatStore.statusText = "复制失败，请手动选择文本复制";
  }
}

/** 编辑：把消息内容放回输入框修改后重新发送 */
function editContent() {
  chatStore.input = props.message.content;
  document.getElementById("chat-input")?.focus();
}
</script>

<template>
  <!-- user：右对齐弱气泡，悬浮出时间与复制/编辑；assistant：按时间顺序铺分段 -->
  <div v-if="message.role === 'user'" class="group flex w-full flex-col items-end gap-1">
    <!-- 悬浮操作条：发送时间 / 复制 / 编辑 -->
    <div
      class="flex items-center gap-1 pr-1 text-[var(--color-dim)] opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100"
    >
      <time
        class="text-[11px]"
        :datetime="new Date(message.createdAt).toISOString()"
        :title="formatTime(message.createdAt)"
      >
        {{ formatTime(message.createdAt) }}
      </time>
      <button
        type="button"
        class="flex size-6 items-center justify-center rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="copied ? '已复制' : '复制消息'"
        :title="copied ? '已复制' : '复制'"
        @click="copyContent"
      >
        <Check v-if="copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
      </button>
      <button
        type="button"
        class="flex size-6 items-center justify-center rounded-md hover:text-[var(--color-txt-strong)]"
        aria-label="编辑消息"
        title="编辑"
        @click="editContent"
      >
        <Pencil class="size-3.5" />
      </button>
    </div>

    <div
      class="max-w-[min(760px,85%)] rounded-2xl border border-[var(--color-line)] bg-[var(--color-side-sel)] px-3.5 py-2 text-[var(--color-txt-strong)]"
    >
      <!-- 随消息发送的技能 tag -->
      <div v-if="skillParts.length" class="mb-1.5 flex flex-wrap justify-end gap-1.5">
        <span
          v-for="skill in skillParts"
          :key="skill.name"
          class="inline-flex max-w-[220px] items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-composer-surface)] py-0.5 pl-1.5 pr-2 text-[11px] text-[var(--color-txt)]"
          :title="skill.description"
        >
          <Sparkles class="size-3 shrink-0 text-[var(--color-mut)]" />
          <span class="truncate">{{ skill.name }}</span>
        </span>
      </div>
      <div class="m-0 whitespace-pre-wrap break-words">{{ message.content }}</div>
      <Attachments v-if="attachmentParts.length" variant="inline" class="mt-2 w-full">
        <Attachment
          v-for="att in attachmentParts"
          :key="att.id"
          :data="att"
          class="max-w-[240px] bg-[var(--color-composer-surface)]"
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      </Attachments>
    </div>
  </div>

  <!-- 工具调用：铺在时间线里，可展开详情 -->
  <div v-else-if="message.role === 'tool'" class="w-full">
    <ToolCallCard v-if="toolMeta" :meta="toolMeta" :content="message.content" />
  </div>

  <div v-else-if="message.role === 'system'" class="w-full">
    <div
      class="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]"
      :class="
        systemTone === 'danger'
          ? 'bg-[var(--color-notice-danger-bg)] text-[var(--color-danger-fg)]'
          : 'border border-[var(--color-line-soft)] bg-[var(--color-side)] text-[var(--color-mut)]'
      "
      :role="systemTone === 'danger' ? 'alert' : 'status'"
    >
      <CircleAlert v-if="systemTone === 'danger'" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 break-words">{{ message.content }}</span>
    </div>
  </div>

  <div v-else class="flex w-full flex-col gap-2">
    <template v-for="(part, index) in parts" :key="`${index}-${part.type}`">
      <!-- 思考块：独立折叠面板，独立弱色 -->
      <Reasoning
        v-if="part.type === 'reasoning'"
        class="w-full"
        :is-streaming="reasoningStreaming(index)"
        :duration="reasoningSeconds(part)"
        :default-open="!hasTextAfter(index) && reasoningStreaming(index)"
      >
        <ReasoningTrigger class="text-[12px]" />
        <ReasoningContent :content="part.text" class="mt-2 text-[12px] reasoning-dim" />
      </Reasoning>

      <!-- 正文：流式 markdown -->
      <Response
        v-else-if="part.type === 'text'"
        :content="part.text"
        class="md-content"
      />

      <!-- 工具调用：icon + 动作 + 高亮目标 + 改动行数，可展开输出 -->
      <ToolCallRow v-else :part="part" />
    </template>

    <!-- 运行状态行：loader + 已运行时长，结束后消失 -->
    <div
      v-if="streaming"
      class="flex items-center gap-1.5 text-[var(--color-mut)]"
      role="status"
    >
      <Loader :size="14" />
      <span class="text-[12px] tabular-nums">
        {{ parts.length ? "运行中" : "正在思考" }} · {{ elapsedText || "0 秒" }}
      </span>
    </div>

    <!-- run 终态语义行：文字 + 图标，颜色仅辅助；空回复也能看到 -->
    <div
      v-else-if="runBanner"
      class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]"
      :class="runToneClass"
      role="status"
    >
      <component :is="runBanner.icon" class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="font-medium">{{ runBanner.label }}</span>
      <span v-if="runBanner.detail" class="min-w-0 text-[var(--color-mut)]">{{ runBanner.detail }}</span>
      <span
        v-if="runSummary?.usage"
        class="text-[11px] text-[var(--color-dim)] tabular-nums"
      >
        输入 {{ runSummary.usage.inputTokens }} / 输出 {{ runSummary.usage.outputTokens }}
      </span>
    </div>
  </div>
</template>