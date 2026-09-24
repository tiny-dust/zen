<script setup lang="ts">
import { Archive, ArchiveRestore, LoaderCircle, Pin, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { classes } from "rattail";

import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";
import { useSessionStatusStore } from "@/stores/session-status";

import type { SessionRuntimeStatus } from "@/stores/session-status";
import type { SessionRecord } from "@zen/shared";

const props = defineProps<{
  session: SessionRecord;
  active: boolean;
}>();

const emit = defineEmits<{
  open: [];
  pin: [];
  archive: [archived: boolean];
  remove: [];
}>();

const sessionStatus = useSessionStatusStore();
const { byId } = storeToRefs(sessionStatus);

const runtimeStatus = computed<SessionRuntimeStatus>(() => byId.value[props.session.id] ?? "idle");
const running = computed(() => runtimeStatus.value === "running");
const needsAction = computed(() => runtimeStatus.value === "needs_action");

/** 结果未读圆点：会话完成/失败且尚未重新打开；停留在当前会话时不展示 */
const showResultDot = computed(
  () => !props.active && !running.value && !needsAction.value && sessionStatus.hasUnseenResult(props.session.id),
);
const resultDotCls = computed(() =>
  runtimeStatus.value === "error" ? "bg-[var(--color-del)]" : "bg-[var(--color-ok)]",
);
const resultDotLabel = computed(() =>
  runtimeStatus.value === "error" ? "上次运行失败" : "上次已完成",
);

/**
 * 行结构：单行标题（超长截断）+ 行尾状态槽（运行 spinner / 需要操作 / 未读点）；
 * 仅选中的会话整行圆角浅色底，其余（含运行中）为普通文本 + hover 高亮，
 * 运行状态只通过行尾 spinner 表达，不参与选中底色。
 */
const rowCls = classes(
  "group/session relative flex h-8 w-full items-center rounded-[var(--radius-sm)] pr-1.5 pl-2 text-left text-[13px] transition-colors duration-[var(--motion-fast)]",
  "text-[var(--color-side-item)]",
  [
    !props.active,
    "hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
  ],
  [
    props.active,
    "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] font-medium",
  ],
  [needsAction.value, "text-[var(--color-txt-strong)]"],
);

const titleCls = classes("block min-w-0 flex-1 truncate", [
  !props.active && props.session.archived,
  "text-[var(--color-dim)]",
]);

const slotCls = "flex size-4 flex-none items-center justify-center";

/** 行尾操作簇：绝对定位悬浮于行上，hover/聚焦时显现，不改变标题排版；
    底色不透明（--color-side-chip），盖住截断在按钮区下的标题文字 */
const hoverClusterCls = classes(
  "absolute top-1/2 right-1.5 z-10 flex -translate-y-1/2 items-center gap-px rounded-[var(--radius-sm)] p-px",
  props.active ? "bg-[var(--color-side-chip-active)]" : "bg-[var(--color-side-chip)]",
  "pointer-events-none opacity-0 transition-opacity duration-[var(--motion-fast)]",
  "group-hover/session:pointer-events-auto group-hover/session:opacity-100",
  "focus-within:pointer-events-auto focus-within:opacity-100",
);
const actionSlotCls = "flex size-7 flex-none items-center justify-center rounded-[var(--radius-sm)]";
const ghostActionCls = classes(
  actionSlotCls,
  "text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]",
);
</script>

<template>
  <div :class="rowCls" :aria-current="active ? 'true' : undefined">
    <Button
      variant="ghost"
      class="h-full flex min-w-0 flex-1 items-center px-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      @click="emit('open')"
    >
      <span :class="titleCls">{{ session.title }}</span>
    </Button>

    <span v-if="session.pinned" :class="slotCls" title="已置顶" aria-label="已置顶">
      <Pin class="size-3 shrink-0 -rotate-45 text-[var(--color-accent)]" aria-hidden="true" />
    </span>

    <span v-if="running" :class="slotCls" title="进行中" aria-label="进行中" role="status">
      <LoaderCircle
        class="size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
    </span>
    <!-- 需要操作：文字 tag 比图标更醒目（askUser 问询 / 工具审批等待） -->
    <span
      v-else-if="needsAction"
      class="flex h-4 flex-none items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-2)_16%,transparent)] px-1.5 text-[10px] leading-none font-medium text-[var(--color-accent-2)]"
      title="等待确认"
      aria-label="待确认"
      role="status"
    >
      待确认
    </span>
    <span
      v-else-if="showResultDot"
      :class="slotCls"
      :title="resultDotLabel"
      :aria-label="resultDotLabel"
      role="status"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="resultDotCls" aria-hidden="true" />
    </span>

    <div :class="hoverClusterCls">
      <Button
        variant="ghost"
        size="icon-sm"
        :class="ghostActionCls"
        :aria-label="session.pinned ? '取消置顶' : '置顶'"
        :title="session.pinned ? '取消置顶' : '置顶'"
        @click.stop="emit('pin')"
      >
        <Pin
          class="size-[13px] shrink-0"
          :class="session.pinned ? '-rotate-45' : ''"
          aria-hidden="true"
        />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="ghostActionCls"
        :aria-label="session.archived ? '取消归档' : '归档'"
        :title="session.archived ? '取消归档' : '归档'"
        @click="emit('archive', !session.archived)"
      >
        <ArchiveRestore v-if="session.archived" class="size-[13px] shrink-0" />
        <Archive v-else class="size-[13px] shrink-0" />
      </Button>
      <DangerIconButton
        :class="actionSlotCls"
        label="删除会话"
        @click="emit('remove')"
      >
        <Trash2 class="size-[13px] shrink-0" />
      </DangerIconButton>
    </div>
  </div>
</template>
