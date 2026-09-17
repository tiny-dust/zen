<script setup lang="ts">
import { Check, Copy, Pencil, Sparkles } from "@lucide/vue";
import { computed, ref } from "vue";

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
import { useChatStore } from "@/stores/chat";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { SelectedSkill } from "@/stores/chat-types";
import type { ChatMessage } from "@zen/shared";

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

const reasoningActive = computed(
  () => props.streaming === true && !props.message.content && !!props.message.reasoning,
);

/** 思考时长（秒）；流式未结束时保持 undefined，触发器显示「思考中…」 */
const reasoningSeconds = computed(() =>
  props.message.reasoningMs ? Math.ceil(props.message.reasoningMs / 1000) : undefined,
);

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

/** 发送时随消息一起带上的技能 tag（正文不含 /skill: 前缀） */
const skillParts = computed<SelectedSkill[]>(() => {
  const meta = props.message.meta as { skills?: SelectedSkill[] } | undefined;
  return meta?.skills ?? [];
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
  <!-- user：右对齐弱气泡，悬浮出时间与复制/编辑；assistant：裸内容直接铺在背板上 -->
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
      class="max-w-[min(760px,85%)] rounded-2xl bg-[var(--color-side-sel)] px-3.5 py-2.5 text-[var(--color-txt-strong)]"
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

  <div v-else-if="message.role === 'system'" class="w-full">
    <div
      class="rounded-[var(--radius-sm)] bg-[var(--color-notice-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--color-danger-fg)]"
      role="alert"
    >
      {{ message.content }}
    </div>
  </div>

  <div v-else class="w-full">
    <Reasoning
      v-if="message.reasoning"
      class="w-full"
      :is-streaming="reasoningActive"
      :duration="reasoningSeconds"
      :default-open="!message.content"
    >
      <ReasoningTrigger />
      <ReasoningContent :content="message.reasoning" class="text-[12px]" />
    </Reasoning>

    <!-- 流式 markdown（vue-stream-markdown 增量渲染，关闭逐段动画保证实时可见） -->
    <Response v-if="message.content" :content="message.content" class="md-content" />

    <div v-else-if="!message.reasoning" class="flex items-center gap-1.5 text-[var(--color-mut)]">
      <Loader :size="14" />
      <span class="text-[13px]">正在思考…</span>
    </div>
  </div>
</template>
