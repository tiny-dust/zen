<script setup lang="ts">
import { Archive, ArchiveRestore, CircleCheck, CircleAlert, LoaderCircle, Pin, Trash2 } from "@lucide/vue";
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
  /** 是否为当前会话所在分组内的列表项（用于辅助说明） */
  inActiveGroup?: boolean;
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

const statusMeta = computed(() => {
  switch (runtimeStatus.value) {
    case "running":
      return { label: "进行中", tone: "running" as const };
    case "needs_action":
      return { label: "需要操作", tone: "needs" as const };
    case "done":
      return { label: "已完成", tone: "done" as const };
    case "error":
      return { label: "失败", tone: "error" as const };
    default:
      return null;
  }
});

/**
 * 当前会话：底色 + 标题加粗 + 「当前」文字徽标（不只靠颜色）。
 * 非当前行保持低对比，悬停才提亮。
 */
const rowCls = classes(
  "group/session relative flex h-9 w-full items-center gap-1 rounded-[var(--radius-sm)] pr-1 pl-1 text-left text-[13px] transition-colors duration-[var(--motion-fast)]",
  "text-[var(--color-side-item)]",
  [
    !props.active,
    "hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
  ],
  [
    props.active,
    "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] font-medium",
  ],
  [runtimeStatus.value === "needs_action", "text-[var(--color-txt-strong)]"],
);

const titleCls = classes(
  "min-w-0 flex-1 truncate",
  [props.active, "font-semibold"],
  [!props.active && props.session.archived, "text-[var(--color-dim)]"],
);

const slotCls = "flex size-7 flex-none items-center justify-center rounded-[6px]";
const ghostActionCls = classes(
  slotCls,
  "text-[var(--color-mut)] opacity-0 transition-opacity duration-[var(--motion-fast)]",
  "hover:text-[var(--color-txt-strong)]",
  "group-hover/session:opacity-100 focus-visible:opacity-100",
  [props.active, "opacity-100 text-[var(--color-mut)]"],
);
</script>

<template>
  <div :class="rowCls" :aria-current="active ? 'true' : undefined">
    <button
      type="button"
      :class="[
        slotCls,
        'flex-none',
        session.pinned
          ? 'text-[var(--color-accent)]'
          : [
              'text-[var(--color-mut)] opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-txt-strong)]',
              active && 'opacity-100',
            ],
      ]"
      :aria-label="session.pinned ? '取消置顶' : '置顶'"
      :title="session.pinned ? '取消置顶' : '置顶'"
      @click.stop="emit('pin')"
    >
      <Pin
        class="size-[13px] shrink-0"
        :class="session.pinned ? '-rotate-45' : ''"
        aria-hidden="true"
      />
    </button>

    <span
      v-if="statusMeta"
      class="flex size-5 flex-none items-center justify-center"
      :title="statusMeta.label"
      :aria-label="statusMeta.label"
      role="status"
    >
      <LoaderCircle
        v-if="statusMeta.tone === 'running'"
        class="size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
      <CircleAlert
        v-else-if="statusMeta.tone === 'needs'"
        class="size-3.5 shrink-0 text-[var(--color-accent-2,#ff8a4c)]"
        aria-hidden="true"
      />
      <CircleCheck
        v-else-if="statusMeta.tone === 'done'"
        class="size-3.5 shrink-0 text-[var(--color-ok)]"
        aria-hidden="true"
      />
      <CircleAlert
        v-else-if="statusMeta.tone === 'error'"
        class="size-3.5 shrink-0 text-[var(--color-danger-fg)]"
        aria-hidden="true"
      />
    </span>
    <span v-else class="size-5 flex-none" aria-hidden="true" />

    <button
      type="button"
      class="flex h-9 min-w-0 flex-1 items-center gap-1.5 pl-0.5 text-left"
      @click="emit('open')"
    >
      <span :class="titleCls">{{ session.title }}</span>
      <span
        v-if="active"
        class="flex-none rounded-[4px] bg-[var(--color-menu-active)] px-1.5 py-px text-[10px] font-medium text-[var(--color-txt-strong)]"
      >
        当前
      </span>
      <span
        v-else-if="statusMeta && statusMeta.tone === 'needs'"
        class="flex-none text-[10.5px] text-[var(--color-accent-2,#ff8a4c)]"
      >
        {{ statusMeta.label }}
      </span>
    </button>

    <div class="flex flex-none items-center gap-px">
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
        class="size-7! rounded-[6px]! opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover/session:opacity-100 focus-visible:opacity-100"
        label="删除会话"
        @click="emit('remove')"
      >
        <Trash2 class="size-[13px] shrink-0" />
      </DangerIconButton>
    </div>
  </div>
</template>
