<script setup lang="ts">
import { Check, FolderOpen, Globe, Plus } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

defineProps<{
  /** 小屏底栏：只显示目录 icon，完整名称进 title */
  compact?: boolean;
}>();

const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { sessionWorkspaceId } = storeToRefs(chatStore);
const { groups } = storeToRefs(workspaceStore);

const workspaceGroups = computed(() =>
  groups.value.filter((item) => !item.archived && item.kind === "workspace"),
);

const currentName = computed(() => {
  if (sessionWorkspaceId.value === workspaceStore.COMMON_ID) {
    return "公共区";
  }
  return (
    groups.value.find((item) => item.id === sessionWorkspaceId.value)?.name || "公共区"
  );
});

function pick(id: string) {
  void chatStore.setSessionWorkspace(id);
}

async function onCreateWorkspace() {
  if (await workspaceStore.create()) {
    pick(workspaceStore.activeId);
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :class="compact ? 'size-7 justify-center' : 'h-7 max-w-[180px] gap-1 px-1.5'"
        :title="`运行目录：${currentName}`"
        :aria-label="`运行目录：${currentName}`"
      >
        <Globe
          v-if="sessionWorkspaceId === workspaceStore.COMMON_ID"
          class="size-4 flex-none"
        />
        <FolderOpen v-else class="size-4 flex-none" />
        <span v-if="!compact" class="truncate text-[11px] font-normal">{{ currentName }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72">
      <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
        Agent 运行目录（工作区或公共区）
      </DropdownMenuLabel>
      <DropdownMenuItem
        class="items-center gap-2"
        :data-active="sessionWorkspaceId === workspaceStore.COMMON_ID"
        @select="pick(workspaceStore.COMMON_ID)"
      >
        <Globe class="size-3.5 flex-none text-[var(--color-mut)]" />
        <span class="min-w-0 flex-1 truncate text-[12.5px]">公共区</span>
        <Check
          v-if="sessionWorkspaceId === workspaceStore.COMMON_ID"
          class="size-3.5 flex-none text-[var(--color-accent)]"
        />
      </DropdownMenuItem>
      <DropdownMenuItem
        v-for="group in workspaceGroups"
        :key="group.id"
        class="items-center gap-2"
        @select="pick(group.id)"
      >
        <FolderOpen class="size-3.5 flex-none text-[var(--color-mut)]" />
        <span class="flex min-w-0 flex-1 flex-col items-start">
          <span class="w-full truncate text-[12.5px] font-medium text-[var(--color-txt-strong)]">
            {{ group.name }}
          </span>
          <span
            class="w-full truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
          >
            {{ group.path }}
          </span>
        </span>
        <Check
          v-if="sessionWorkspaceId === group.id"
          class="size-3.5 flex-none text-[var(--color-accent)]"
        />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2" @select="onCreateWorkspace">
        <Plus class="size-3.5" />
        <span class="text-[12px]">添加工作区目录…</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
