<script setup lang="ts">
import { computed } from "vue";

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
import TaskUpdateCard from "@/components/chat/TaskUpdateCard.vue";
import ToolCallCard from "@/components/chat/ToolCallCard.vue";

import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ChatMessage, TaskItem, ToolCallMessageMeta } from "@zen/shared";

const props = defineProps<{
  message: ChatMessage;
  streaming?: boolean;
}>();

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
  };
});

const taskSnapshot = computed(() => {
  if (props.message.role !== "tool") {
    return null;
  }
  const meta = props.message.meta as
    | { kind?: string; version?: number; items?: TaskItem[] }
    | undefined;
  if (meta?.kind !== "tasks" || !Array.isArray(meta.items)) {
    return null;
  }
  return { version: meta.version ?? 1, items: meta.items };
});
</script>

<template>
  <!-- user：右对齐弱气泡；assistant：裸内容直接铺在背板上（MiMo 同构） -->
  <div v-if="message.role === 'user'" class="flex w-full justify-end">
    <div
      class="max-w-[min(760px,85%)] rounded-2xl bg-[var(--color-side-sel)] px-3.5 py-2.5 text-[var(--color-txt-strong)]"
    >
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

  <!-- 工具调用 / 任务清单快照：铺在时间线里，可展开详情 -->
  <div v-else-if="message.role === 'tool'" class="w-full">
    <TaskUpdateCard
      v-if="taskSnapshot"
      :version="taskSnapshot.version"
      :items="taskSnapshot.items"
    />
    <ToolCallCard
      v-else-if="toolMeta"
      :meta="toolMeta"
      :content="message.content"
    />
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

    <!-- 流式 markdown（vue-stream-markdown 增量渲染） -->
    <Response v-if="message.content" :content="message.content" class="md-content" />

    <div v-else-if="!message.reasoning" class="flex items-center gap-1.5 text-[var(--color-mut)]">
      <Loader :size="14" />
      <span class="text-[13px]">正在思考…</span>
    </div>
  </div>
</template>
