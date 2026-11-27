<script setup lang="ts">
import { IconChevronDown as ChevronDown, IconFolder as FolderClosed } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sortGroupsByActivity, sortSessionsByActivity } from "@/lib/workspace-order";
import { useChatStore } from "@/stores/chat";
import { useWorkbenchPageStore } from "@/stores/workbench-page";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord } from "@zen/shared";

/**
 * 顶栏中段「会话名 + 下拉切换」（对齐 nomi 的 SessionTitle）：
 * 触发器是当前会话名，浮层列出最近会话，选中即切过去并回到对话页。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const pageStore = useWorkbenchPageStore();
const { sessionName, sessionId } = storeToRefs(chatStore);

/** 最近会话：按工作区活动度 + 组内活动度排序，取前 12 条 */
const recent = computed<SessionRecord[]>(() => {
  const groups = sortGroupsByActivity(workspaceStore.groups.filter((group) => !group.archived));
  return groups.flatMap((group) => sortSessionsByActivity(group.sessions.filter((item) => !item.archived))).slice(0, 12);
});

async function open(record: SessionRecord) {
  for (const group of workspaceStore.groups) {
    if (group.sessions.some((item) => item.id === record.id)) {
      workspaceStore.setActive(group.id);
      break;
    }
  }
  pageStore.close();
  await chatStore.loadSession(record);
}

async function createSession() {
  pageStore.close();
  await chatStore.newTask();
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-8 min-w-0 shrink max-w-[320px] justify-start gap-1.5 overflow-hidden rounded-[var(--radius-md)] px-2 text-[13px] font-medium text-[var(--color-txt)]"
        :title="sessionName"
      >
        <FolderClosed class="size-4 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ sessionName }}</span>
        <ChevronDown class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-[240px]">
      <DropdownMenuLabel class="text-[12px] text-[var(--color-mut)]">
        {{ t("shell.switchSession") }}
      </DropdownMenuLabel>
      <p v-if="!recent.length" class="m-0 px-2 py-1.5 text-[12px] text-[var(--color-dim)]">
        {{ t("shell.noSessions") }}
      </p>
      <DropdownMenuItem
        v-for="item in recent"
        :key="item.id"
        class="gap-2 text-[13px]"
        :class="item.id === sessionId ? 'text-[var(--color-txt-strong)]' : ''"
        @select="open(item)"
      >
        <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="text-[13px]" @select="createSession">
        {{ t("shell.newChat") }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
