<script setup lang="ts">
import { Ban, Check, CircleAlert, Copy, Globe, Pencil, Play, Pause, RefreshCw, Sparkles, TriangleAlert, Zap } from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";

import { Loader } from "@/components/ai-elements/loader";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import ContextCompactCard from "@/components/chat/ContextCompactCard.vue";
import ToolCallCard from "@/components/chat/ToolCallCard.vue";
import ToolCallGroup from "@/components/chat/ToolCallGroup.vue";
import { groupMessageParts } from "@/components/chat/message-groups";
import FileLabel from "@/components/files/FileLabel.vue";
import { Button } from "@/components/ui/button";
import { formatElementDetail } from "@/lib/browser-element";
import { useChatStore } from "@/stores/chat";
import { useRightPanelStore } from "@/stores/right-panel";
import type { SelectedSkill } from "@/stores/chat-types";
import type { ComposerElementMark } from "@/lib/browser-element";
import type {
  BrowserElementRef,
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

const rightPanel = useRightPanelStore();

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

const displayParts = computed(() => groupMessageParts(parts.value));

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

const attachmentParts = computed(() => {
  const meta = props.message.meta as { attachments?: Array<{ name: string; path?: string }> } | undefined;
  return meta?.attachments ?? [];
});

/** 插入执行的用户消息：气泡上方加「已插入」徽标（打断原任务、高权重先执行） */
const insertedBadge = computed(
  () => (props.message.meta as { inserted?: boolean } | undefined)?.inserted === true,
);

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

/** 压缩卡展示字段：meta.output 为摘要全文，meta.args.compactedTurns 为折叠条数 */
const compactSummary = computed(() => {
  const meta = props.message.meta as { output?: unknown } | undefined;
  return typeof meta?.output === "string" ? meta.output : props.message.content;
});
const compactCount = computed(() => {
  const meta = props.message.meta as { args?: { compactedTurns?: number } } | undefined;
  const n = meta?.args?.compactedTurns;
  return typeof n === "number" && n > 0 ? n : undefined;
});

/** 发送时随消息一起带上的技能 tag（token 内联在正文里） */
const skillParts = computed<SelectedSkill[]>(() => {
  const meta = props.message.meta as { skills?: SelectedSkill[] } | undefined;
  return meta?.skills ?? [];
});

/** 浏览器标注元素 tag：与技能同构，Globe + 名称，悬浮看明细 */
const elementParts = computed(() => {
  const meta = props.message.meta as { elementMarks?: ComposerElementMark[] } | undefined;
  return meta?.elementMarks ?? [];
});

function elementHoverTitle(ref: BrowserElementRef): string {
  return formatElementDetail(ref);
}

/** 用户气泡正文：隐藏 /skill: 与 $el: 内联 token（上方 tag 已呈现），原始内容保留供「编辑」回填 */
const userText = computed(() =>
  props.message.content
    .replace(/\/skill:[^\s/]+\s?/g, "")
    .replace(/\$el:[^\s$]+\s?/g, "")
    .trim(),
);

/**
 * @文件引用分段：composer 里 @ 选中文件会以 `$相对路径` 写入正文，
 * 气泡里渲染成文件 chip 而不是裸路径。要求 token 以字母/下划线开头
 * （排除 "$100" 这类纯数字），目录引用含 / 或带扩展名的文件名均命中。
 */
const FILE_REF_RE = /\$([A-Za-z_][\w.-]*(?:\/[\w.-]+)*)/g;

const userSegments = computed<Array<{ type: "text" | "file"; text: string; path?: string }>>(() => {
  const source = userText.value;
  if (!source.includes("$")) {
    return [{ type: "text", text: source }];
  }
  const segments: Array<{ type: "text" | "file"; text: string; path?: string }> = [];
  let cursor = 0;
  for (const match of source.matchAll(FILE_REF_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: "text", text: source.slice(cursor, start) });
    }
    segments.push({ type: "file", text: match[0], path: match[1] ?? "" });
    cursor = start + match[0].length;
  }
  if (cursor < source.length) {
    segments.push({ type: "text", text: source.slice(cursor) });
  }
  return segments;
});

function openFileRef(path: string) {
  rightPanel.revealFile(path);
}

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
  if (!reason) {
    return null;
  }
  if (reason === "stop") {
    // 正常完成也给一行语义，但用弱色，避免成为噪音
    return {
      label: "已完成",
      tone: "mut",
      icon: Check,
      detail: summary.step != null ? `共 ${summary.step} 步` : undefined,
    };
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

/** 编辑并插入对话：内容回填输入框，发送时从该条分叉（其后旧分支被替换） */
function editContent() {
  chatStore.startEditFrom(props.message);
  document.getElementById("chat-input")?.focus();
}
</script>

<template>
  <!-- user：右对齐弱气泡；消息底部常显时间 / 复制 / 编辑 -->
  <div v-if="message.role === 'user'" class="flex w-full flex-col items-end gap-1">
    <div
      class="max-w-[min(760px,85%)] rounded-2xl border border-[var(--color-line)] bg-[var(--color-side-sel)] px-3.5 py-2 text-[var(--color-txt-strong)]"
    >
      <!-- 插入执行徽标：打断原任务、以最高权重先执行 -->
      <div v-if="insertedBadge" class="mb-1.5 flex justify-end">
        <span
          class="inline-flex items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-composer-surface)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-accent)]"
          title="该消息通过「插入执行」打断原任务优先执行，原任务已在完成后自动恢复"
        >
          <Zap class="size-3" aria-hidden="true" />
          已插入
        </span>
      </div>
      <!-- 随消息发送的技能 / 页面元素 tag -->
      <div
        v-if="skillParts.length || elementParts.length"
        class="mb-1.5 flex flex-wrap justify-end gap-1.5"
      >
        <span
          v-for="skill in skillParts"
          :key="skill.name"
          class="inline-flex max-w-[220px] items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-composer-surface)] py-0.5 pl-1.5 pr-2 text-[11px] text-[var(--color-txt)]"
          :title="skill.description"
        >
          <Sparkles class="size-3 shrink-0 text-[var(--color-mut)]" />
          <span class="truncate">{{ skill.name }}</span>
        </span>
        <span
          v-for="el in elementParts"
          :key="el.id"
          class="inline-flex max-w-[220px] items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-composer-surface)] py-0.5 pl-1.5 pr-2 text-[11px] text-[var(--color-txt)]"
          :title="elementHoverTitle(el.ref)"
        >
          <Globe class="size-3 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          <span class="truncate">{{ el.label }}</span>
        </span>
      </div>
      <div class="m-0 whitespace-pre-wrap break-words"><template v-for="(seg, index) in userSegments" :key="index"><template v-if="seg.type === 'file'"><button
            type="button"
            class="mx-0.5 inline-flex max-w-full items-center gap-1 align-text-bottom rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[12px] leading-tight text-[var(--color-link)] hover:underline"
            :title="seg.path"
            @click="openFileRef(seg.path ?? '')"
          >
            <FileLabel :path="seg.path ?? ''" class="max-w-[240px]" variant="link" />
          </button></template><template v-else>{{ seg.text }}</template></template></div>
      <div v-if="attachmentParts.length" class="mt-2 flex max-w-full flex-wrap gap-x-3 gap-y-1">
        <template v-for="(att, index) in attachmentParts" :key="`${att.name}-${index}`">
          <Button
            v-if="att.path"
            variant="link"
            class="h-auto min-w-0 max-w-full shrink border-0 p-0 text-[12px] font-normal no-underline hover:no-underline"
            @click="rightPanel.revealFile(att.path)"
          >
            <FileLabel :path="att.path" :name="att.name" variant="link" />
          </Button>
          <FileLabel v-else :path="att.name" class="text-[12px]" />
        </template>
      </div>
    </div>

    <!-- 消息底部操作行：发送时间 / 复制 / 编辑（编辑后发送从该条插入分叉） -->
    <div class="flex items-center gap-1 pr-1 text-[var(--color-dim)]">
      <time
        class="text-[11px]"
        :datetime="new Date(message.createdAt).toISOString()"
        :title="formatTime(message.createdAt)"
      >
        {{ formatTime(message.createdAt) }}
      </time>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="copied ? '已复制' : '复制消息'"
        :title="copied ? '已复制' : '复制'"
        @click="copyContent"
      >
        <Check v-if="copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        aria-label="编辑消息并插入对话"
        title="编辑并插入对话"
        @click="editContent"
      >
        <Pencil class="size-3.5" />
      </Button>
    </div>
  </div>

  <!-- 工具调用：铺在时间线里，可展开详情；上下文压缩走专用醒目卡片 -->
  <div v-else-if="message.role === 'tool'" class="w-full min-w-0 max-w-full">
    <ContextCompactCard
      v-if="toolMeta?.toolName === 'contextCompact'"
      :summary="compactSummary"
      :compacted-count="compactCount"
      :label="toolMeta.summary"
    />
    <ToolCallCard v-else-if="toolMeta" :meta="toolMeta" :content="message.content" />
  </div>

  <div v-else-if="message.role === 'system'" class="w-fit min-w-0 max-w-[min(100%,72ch)]">
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

  <div v-else class="message-assistant flex min-w-0 max-w-full flex-col items-start gap-2">
    <template v-for="part in displayParts" :key="part.key">
      <Reasoning
        v-if="part.type === 'reasoning'"
        class="w-full min-w-0 max-w-full"
        :is-streaming="reasoningStreaming(part.index)"
        :duration="reasoningSeconds(part)"
        :default-open="!hasTextAfter(part.index) && reasoningStreaming(part.index)"
      >
        <ReasoningTrigger class="w-fit max-w-full text-[12px]" />
        <ReasoningContent :content="part.text" class="mt-2 min-w-0 text-[12px] reasoning-dim" />
      </Reasoning>

      <Response
        v-else-if="part.type === 'text'"
        :content="part.text"
        class="md-content w-full min-w-0 max-w-full"
      />

      <ToolCallGroup v-else :tools="part.tools" />
    </template>

    <!-- 运行状态行：loader + 已运行时长 + 暂停/继续，结束后消失 -->
    <div
      v-if="streaming"
      class="flex items-center gap-1.5 text-[var(--color-mut)]"
      role="status"
    >
      <Loader :size="14" />
      <span class="text-[12px] tabular-nums">
        {{ parts.length ? "运行中" : "正在思考" }} · {{ elapsedText || "0 秒" }}
      </span>
      <Button
        v-if="!chatStore.isPaused"
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        aria-label="暂停运行"
        title="暂停"
        @click="chatStore.pause()"
      >
        <Pause class="size-3.5" />
      </Button>
      <Button
        v-else
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        aria-label="继续运行"
        title="继续"
        @click="chatStore.resume()"
      >
        <Play class="size-3.5" />
      </Button>
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

    <!-- 消息底部操作行：发送时间 / 复制 / 重试（重新生成本轮回复） -->
    <div v-if="!streaming" class="flex items-center gap-1 text-[var(--color-dim)]">
      <time
        class="text-[11px]"
        :datetime="new Date(message.createdAt).toISOString()"
        :title="formatTime(message.createdAt)"
      >
        {{ formatTime(message.createdAt) }}
      </time>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="copied ? '已复制' : '复制消息'"
        :title="copied ? '已复制' : '复制'"
        @click="copyContent"
      >
        <Check v-if="copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        aria-label="重新生成本轮回复"
        title="重试"
        @click="chatStore.retryFrom(message.id)"
      >
        <RefreshCw class="size-3.5" />
      </Button>
    </div>
  </div>
</template>