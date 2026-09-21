<script setup lang="ts">
import { ChevronDown, FolderOpen } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { DesktopOpener } from "@/types/zen-api";

const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();

const openers = ref<DesktopOpener[]>([]);
const busyId = ref("");

const workdir = computed(() => workspaceStore.pathOf(chatStore.sessionWorkspaceId));
const visible = computed(() => Boolean(workdir.value));

onMounted(async () => {
  if (!window.zen?.shell) {
    return;
  }
  openers.value = await window.zen.shell.listOpeners();
});

async function openWith(id: string) {
  const path = workdir.value;
  const zen = window.zen;
  if (!path || !zen?.shell || busyId.value) {
    return;
  }
  busyId.value = id;
  try {
    await zen.shell.openWith(id, path);
  } finally {
    busyId.value = "";
  }
}
</script>

<template>
  <DropdownMenu v-if="visible">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="flex h-7 items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-composer-surface)] px-2.5 text-[12px] font-normal text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)] dark:hover:bg-[var(--color-menu-hover)] aria-expanded:bg-[var(--color-composer-surface)] aria-expanded:text-[var(--color-txt)]"
        :title="workdir"
      >
        <FolderOpen class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span>打开位置</span>
        <ChevronDown class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-[180px]">
      <DropdownMenuItem
        v-for="item in openers"
        :key="item.id"
        class="gap-2"
        @select="openWith(item.id)"
      >
        <img
          v-if="item.icon"
          :src="item.icon"
          alt=""
          class="size-4 flex-none object-contain"
        />
        <span
          v-else
          class="flex size-4 flex-none items-center justify-center rounded-[3px] bg-[var(--color-chip-bg)] text-[9px] text-[var(--color-dim)]"
          aria-hidden="true"
        >
          {{ item.label.slice(0, 1) }}
        </span>
        <span>{{ item.label }}</span>
      </DropdownMenuItem>
      <DropdownMenuItem v-if="!openers.length" disabled>
        未检测到可用应用
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
