<script setup lang="ts">
import { AudioLines, Ban, Check, CircleAlert, Copy, GitBranch, Globe, Pencil, Play, Pause, RefreshCw, ScanText, Sparkles, TriangleAlert, Volume2, Zap } from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

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
import { openSessionById } from "@/lib/open-session";
import { useOcr, useTts } from "@/composables/useSystemAbilities";
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

const { t } = useI18n();

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
  const detail = formatElementDetail(ref);
  // 已定位到源码文件：title 尾部追加点击提示（chip 变为可点击）
  if (ref.sourceFiles?.length) {
    return `${detail}\n${t("chat.bubble.elementRevealSource")}`;
  }
  return detail;
}

/** 元素 tag chip 点击：在右侧文件面板定位命中的第一个源码文件 */
function revealElementSource(mark: ComposerElementMark): void {
  const file = mark.ref.sourceFiles?.[0];
  if (file) {
    rightPanel.revealFile(file);
  }
}

/** 用户气泡正文：隐藏 /skill: 与 $el: 内联 token（上方 tag 已呈现），原始内容保留供「编辑」回填 */
const userText = computed(() => {
  let text = props.message.content
    .replace(/\/skill:[^\s/]+\s?/g, "")
    .replace(/\$el:[^\s$]+\s?/g, "");
  // 已带附件的 `$名称` 引用同样隐藏（下方附件行已呈现文件/缩略图）；
  // split/join 精确匹配，含空格/数字开头的文件名也能正常隐藏
  for (const att of attachmentParts.value) {
    text = text.split(`$${att.name}`).join("");
  }
  return text.trim();
});

/**
 * @文件引用分段：composer 里 @ 选中文件会以 `$相对路径` 写入正文，
 * 气泡里渲染成文件 chip 而不是裸路径。要求 token 以字母/下划线开头
 * （排除 "$100" 这类纯数字），目录引用、中文路径、无扩展名文件均命中。
 */
const FILE_REF_RE = /\$([\p{L}_][\p{L}\p{N}_.\/-]*)/gu;

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
      label: t("chat.bubble.runDone"),
      tone: "mut",
      icon: Check,
      detail: summary.step != null ? t("chat.bubble.totalSteps", { n: summary.step }) : undefined,
    };
  }
  if (reason === "cancelled") {
    return {
      label: t("chat.bubble.runCancelled"),
      tone: "warn",
      icon: Ban,
      detail: t("chat.bubble.runCancelledDetail"),
    };
  }
  if (reason === "error") {
    return {
      label: t("chat.bubble.runFailed"),
      tone: "err",
      icon: CircleAlert,
      detail: summary.error || t("chat.bubble.runFailedFallback"),
    };
  }
  return {
    label: t("chat.bubble.stepLimit"),
    tone: "warn",
    icon: TriangleAlert,
    detail: summary.step != null ? t("chat.bubble.totalSteps", { n: summary.step }) : undefined,
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

/**
 * 「继续」按钮：仅最后一条助手消息且本轮异常终止（失败/取消/步骤上限）时显示。
 * 与「重试」（截断本轮重新生成）区分：继续保留全部历史，从已完成进度接着做。
 */
const canContinue = computed(() => {
  if (props.streaming || chatStore.messages.at(-1)?.id !== props.message.id) {
    return false;
  }
  const reason = runSummary.value?.reason;
  return reason != null && reason !== "stop";
});

/**
 * 「继续推进目标」（Goals 目标模式）：run 正常结束（done stop）且目标 active 时，
 * 最后一条助手消息的底部操作行出现一键续跑入口；不自动循环。
 */
const canContinueGoal = computed(() => {
  if (props.streaming || chatStore.isRunning || chatStore.messages.at(-1)?.id !== props.message.id) {
    return false;
  }
  return runSummary.value?.reason === "stop" && chatStore.sessionGoal?.status === "active";
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
    : t("chat.bubble.dateWithTime", { m: date.getMonth() + 1, d: date.getDate(), time: hm });
}

const copied = ref(false);

/** 流式运行时长：每秒跳动的已运行时间，让用户知道回复仍在进行 */
const elapsedText = ref("");
let elapsedTimer: number | undefined;

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return t("chat.bubble.secondsShort", { n: seconds });
  }
  return t("chat.bubble.minutesSeconds", { m: Math.floor(seconds / 60), s: String(seconds % 60).padStart(2, "0") });
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
    chatStore.statusText = t("chat.bubble.copyFailed");
  }
}

/** 从该条消息分叉：新会话复制到这里为止的对话，原会话不变；成功后切过去继续 */
async function forkFromHere() {
  const forkedId = await chatStore.forkFrom(props.message.id);
  if (forkedId) {
    await openSessionById(forkedId);
  }
}

/** 编辑并插入对话：内容回填输入框，发送时从该条分叉（其后旧分支被替换） */
function editContent() {
  chatStore.startEditFrom(props.message);
  document.getElementById("chat-input")?.focus();
}

// TTS 朗读（平台不支持时按钮隐藏；speakingId 模块级共享，同一时刻只播一条）
const { supported: ttsSupported, speakingId: ttsSpeakingId, toggle: toggleTts } = useTts();

async function speakMessage() {
  try {
    await toggleTts(props.message.id, props.message.content);
  } catch (error) {
    chatStore.statusText =
      error instanceof Error && error.message !== "EMPTY"
        ? error.message
        : t("system-abilities.tts.failed");
  }
}

// OCR：图片附件「识别文字」，结果插入输入框光标处（平台不支持时隐藏）
const { supported: ocrSupported, recognizing: ocrRecognizing, recognize: recognizeImage } = useOcr();

const IMAGE_ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

function isImageAttachment(att: { name: string; path?: string }): boolean {
  return IMAGE_ATTACHMENT_RE.test(att.path ?? "") || IMAGE_ATTACHMENT_RE.test(att.name);
}

/**
 * 图片附件缩略图：previewFile 读 dataUrl（绝对路径可用，工作区外的上传图也能出图）。
 * 加载失败的图片回退到文件 chip 行展示，不丢任何附件信息。
 */
const imageThumbs = ref(new Map<string, string>());

watch(
  () => attachmentParts.value.filter((att) => att.path && isImageAttachment(att)).map((att) => att.path),
  async (paths) => {
    const zen = window.zen;
    const wanted = new Set(paths);
    for (const [path] of imageThumbs.value) {
      if (!wanted.has(path)) {
        imageThumbs.value.delete(path);
      }
    }
    if (!zen) {
      return;
    }
    for (const path of paths) {
      if (!path || imageThumbs.value.has(path)) {
        continue;
      }
      try {
        const preview = await zen.workspace.previewFile(undefined, path);
        if (preview?.kind === "image") {
          imageThumbs.value.set(path, preview.dataUrl);
        }
      } catch {
        // 读不出图：保持文件 chip 兜底展示
      }
    }
  },
  { immediate: true },
);

const imageThumbList = computed(() =>
  [...imageThumbs.value.entries()].map(([path, url]) => {
    const att = attachmentParts.value.find((item) => item.path === path);
    return { path, url, name: att?.name ?? path };
  }),
);

/** 文件 chip 行：非图片附件 + 缩略图没加载出来的附件（图片都进了缩略图行） */
const fileAttachments = computed(() =>
  attachmentParts.value.filter((att) => !imageThumbs.value.has(att.path ?? "")),
);

async function ocrAttachment(path: string) {
  try {
    const text = await recognizeImage(path);
    chatStore.insertAtComposerCaret(text);
  } catch (error) {
    chatStore.statusText =
      error instanceof Error && error.message !== "EMPTY"
        ? error.message
        : t("system-abilities.ocr.emptyResult");
  }
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
          class="inline-flex items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-composer-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]"
          :title="t('chat.bubble.insertedTitle')"
        >
          <Zap class="size-3" aria-hidden="true" />
          {{ t("chat.bubble.inserted") }}
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
        <template v-for="el in elementParts" :key="el.id">
          <!-- 已定位到源码文件：chip 可点击，在右侧文件面板定位 -->
          <button
            v-if="el.ref.sourceFiles?.length"
            type="button"
            class="inline-flex max-w-[220px] cursor-pointer items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-composer-surface)] py-0.5 pl-1.5 pr-2 text-left text-[11px] text-[var(--color-txt)]"
            :title="elementHoverTitle(el.ref)"
            @click="revealElementSource(el)"
          >
            <Globe class="size-3 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            <span class="truncate">{{ el.label }}</span>
          </button>
          <span
            v-else
            class="inline-flex max-w-[220px] items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-composer-surface)] py-0.5 pl-1.5 pr-2 text-[11px] text-[var(--color-txt)]"
            :title="elementHoverTitle(el.ref)"
          >
            <Globe class="size-3 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            <span class="truncate">{{ el.label }}</span>
          </span>
        </template>
      </div>
      <div class="m-0 whitespace-pre-wrap break-words"><template v-for="(seg, index) in userSegments" :key="index"><template v-if="seg.type === 'file'"><button
            type="button"
            class="mx-0.5 inline-flex max-w-full items-center gap-1 align-text-bottom rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[12px] leading-tight text-[var(--color-link)] hover:underline"
            :title="seg.path"
            @click="openFileRef(seg.path ?? '')"
          >
            <FileLabel :path="seg.path ?? ''" class="max-w-[240px]" variant="link" />
          </button></template><template v-else>{{ seg.text }}</template></template></div>
      <!-- 图片附件：真实缩略图（点击在右侧面板打开），悬浮出 OCR 识别入口 -->
      <div v-if="imageThumbList.length" class="mt-2 flex max-w-full flex-wrap justify-end gap-1.5">
        <div v-for="thumb in imageThumbList" :key="thumb.path" class="group/th relative">
          <button
            type="button"
            class="block overflow-hidden rounded-lg border border-[var(--color-line)]"
            :title="thumb.name"
            @click="openFileRef(thumb.path)"
          >
            <img :src="thumb.url" :alt="thumb.name" class="max-h-40 max-w-full" loading="lazy">
          </button>
          <Button
            v-if="ocrSupported"
            variant="ghost"
            size="icon-xs"
            class="absolute right-1 top-1 rounded-md bg-[var(--color-side)]/85 opacity-0 transition-opacity group-hover/th:opacity-100"
            :disabled="ocrRecognizing"
            :aria-label="t('system-abilities.ocr.recognize')"
            :title="ocrRecognizing ? t('system-abilities.ocr.recognizing') : t('system-abilities.ocr.recognizeTitle')"
            @click="ocrAttachment(thumb.path)"
          >
            <ScanText class="size-3.5" />
          </Button>
        </div>
      </div>
      <!-- 文件附件 chip 行：非图片 + 缩略图没加载出来的（图片已进缩略图行） -->
      <div v-if="fileAttachments.length" class="mt-2 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
        <template v-for="(att, index) in fileAttachments" :key="`${att.name}-${index}`">
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
        :aria-label="copied ? t('common.copied') : t('chat.bubble.copyMessage')"
        :title="copied ? t('common.copied') : t('common.copy')"
        @click="copyContent"
      >
        <Check v-if="copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.editMessage')"
        :title="t('chat.bubble.editInsert')"
        @click="editContent"
      >
        <Pencil class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.forkTitle')"
        :title="t('chat.bubble.forkTooltip')"
        @click="forkFromHere"
      >
        <GitBranch class="size-3.5" />
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
      class="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[12px]"
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
        {{ parts.length ? t("chat.bubble.running") : t("chat.bubble.thinking") }} · {{ elapsedText || t("chat.bubble.secondsShort", { n: 0 }) }}
      </span>
      <Button
        v-if="!chatStore.isPaused"
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.pauseRun')"
        :title="t('chat.bubble.pause')"
        @click="chatStore.pause()"
      >
        <Pause class="size-3.5" />
      </Button>
      <Button
        v-else
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.resumeRun')"
        :title="t('chat.resume')"
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
        {{ t("chat.bubble.usageLine", { input: runSummary.usage.inputTokens, output: runSummary.usage.outputTokens }) }}
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
        :aria-label="copied ? t('common.copied') : t('chat.bubble.copyMessage')"
        :title="copied ? t('common.copied') : t('common.copy')"
        @click="copyContent"
      >
        <Check v-if="copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.retryTitle')"
        :title="t('chat.bubble.retryTooltip')"
        @click="chatStore.retryFrom(message.id)"
      >
        <RefreshCw class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="rounded-md hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.forkTitle')"
        :title="t('chat.bubble.forkTooltip')"
        @click="forkFromHere"
      >
        <GitBranch class="size-3.5" />
      </Button>
      <!-- 朗读：TTS 播报本条消息（平台不支持时隐藏；播放中变停止） -->
      <Button
        v-if="ttsSupported"
        variant="ghost"
        size="icon-xs"
        class="rounded-md transition-colors"
        :class="
          ttsSpeakingId === message.id
            ? 'text-[var(--color-accent)] hover:text-[var(--color-accent)]'
            : 'hover:text-[var(--color-txt-strong)]'
        "
        :aria-label="ttsSpeakingId === message.id ? t('system-abilities.tts.stop') : t('system-abilities.tts.speak')"
        :title="ttsSpeakingId === message.id ? t('system-abilities.tts.stopTitle') : t('system-abilities.tts.speakTitle')"
        @click="speakMessage"
      >
        <AudioLines v-if="ttsSpeakingId === message.id" class="size-3.5" />
        <Volume2 v-else class="size-3.5" />
      </Button>
      <!-- 异常终止后专用：保留历史续跑，与左侧「重试」（截断重跑）区分 -->
      <Button
        v-if="canContinue"
        variant="ghost"
        size="icon-xs"
        class="rounded-md text-[var(--color-accent)] hover:text-[var(--color-txt-strong)]"
        :aria-label="t('chat.bubble.continueTitle')"
        :title="t('chat.bubble.continueTooltip')"
        @click="chatStore.continueRun()"
      >
        <Play class="size-3.5" />
      </Button>
      <!-- 目标模式：run 正常结束且目标 active 时的一键续跑（单次手动触发，不自动循环） -->
      <Button
        v-if="canContinueGoal"
        variant="ghost"
        class="h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :aria-label="t('goal.continue')"
        :title="t('goal.continueTitle')"
        @click="chatStore.continueGoal()"
      >
        <Play class="size-3" aria-hidden="true" />
        {{ t("goal.continue") }}
      </Button>
    </div>
  </div>
</template>