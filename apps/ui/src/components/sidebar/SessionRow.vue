<script setup lang="ts">
import { MoreHorizontal, Pin, PinOff } from "@lucide/vue";
import { classes } from "rattail";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  "group/session flex h-8 w-full items-center rounded-[var(--radius-sm)] pr-1 text-left text-[12.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
  [
    props.active,
    "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] hover:bg-[var(--color-side-sel)]",
  ],
);

function indent() {
  return (props.depth ?? 1) * 12 + 4;
}
</script>

<template>
  <div :class="rowCls">
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
      :style="{ paddingLeft: `${indent()}px` }"
      @click="emit('open')"
    >
      <Pin
        v-if="session.pinned"
        class="size-3 flex-none -rotate-45 text-[var(--color-accent)]"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 truncate" :class="session.archived ? 'text-[var(--color-dim)]' : ''">
        {{ session.title }}
      </span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="flex size-6 flex-none items-center justify-center rounded text-[var(--color-dim)] opacity-0 hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)] group-hover/session:opacity-100"
          aria-label="会话操作"
        >
          <MoreHorizontal class="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[132px]">
        <DropdownMenuItem @select="emit('pin')">
          <Pin v-if="!session.pinned" class="size-3.5" />
          <PinOff v-else class="size-3.5" />
          {{ session.pinned ? "取消置顶" : "置顶" }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="!session.archived" @select="emit('archive', true)">
          归档
        </DropdownMenuItem>
        <DropdownMenuItem v-else @select="emit('archive', false)">
          取消归档
        </DropdownMenuItem>
        <DropdownMenuItem
          class="text-[var(--color-danger-fg)]"
          @select="emit('remove')"
        >
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
