<script setup lang="ts">
import { Archive, ArchiveRestore, Pin, Trash2 } from "@lucide/vue";
import { classes } from "rattail";

import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";

import type { SessionRecord } from "@zen/shared";

const props = defineProps<{
  session: SessionRecord;
  active: boolean;
  depth?: number;
}>();

const emit = defineEmits<{
  open: [];
  pin: [];
  archive: [archived: boolean];
  remove: [];
}>();

const rowCls = classes(
  "group/session relative flex h-8 w-full items-center rounded-[var(--radius-sm)] pr-0.5 text-left text-[12.5px] text-[var(--color-side-item)] transition-colors duration-[var(--motion-fast)]",
  "hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
  [
    props.active,
    "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] hover:bg-[var(--color-side-sel)]",
  ],
);

/** 左右图标按钮同规格，保证与标题光学对齐 */
const slotCls = "flex size-7 flex-none items-center justify-center rounded-[6px]";
const ghostActionCls = classes(
  slotCls,
  "text-[var(--color-mut)] opacity-0 transition-opacity duration-[var(--motion-fast)]",
  "hover:text-[var(--color-txt-strong)]",
  "group-hover/session:opacity-100 focus-visible:opacity-100",
);
</script>

<template>
  <div :class="rowCls">
    <!-- 置顶：固定最左槽位，已置顶常显，未置顶悬停出现 -->
    <button
      type="button"
      :class="[
        slotCls,
        'ml-0.5 flex-none',
        session.pinned
          ? 'text-[var(--color-accent)]'
          : [
              'text-[var(--color-mut)] opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-txt-strong)]',
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

    <button
      type="button"
      class="flex h-8 min-w-0 flex-1 items-center pl-0.5 text-left"
      @click="emit('open')"
    >
      <span
        class="min-w-0 flex-1 truncate"
        :class="session.archived ? 'text-[var(--color-dim)]' : ''"
      >
        {{ session.title }}
      </span>
    </button>

    <div class="flex flex-none items-center gap-px pr-0.5">
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
