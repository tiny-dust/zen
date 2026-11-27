<script setup lang="ts">
import { IconActivity as Activity, IconLoader2 as LoaderCircle } from "@tabler/icons-vue";
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
import { useSessionStatusStore } from "@/stores/session-status";
import { useWorkbenchPageStore } from "@/stores/workbench-page";
import { useWorkspaceStore } from "@/stores/workspace";

/**
 * 顶栏左段「系统信息」（对齐 nomi 的 fleet indicator）：
 * 触发器常显在跑数量，浮层列出进行中的会话，底部跳 Agent 看板。
 */
const { t } = useI18n();
const statusStore = useSessionStatusStore();
const workspaceStore = useWorkspaceStore();
const pageStore = useWorkbenchPageStore();
const { byId } = storeToRefs(statusStore);

const running = computed(() => {
  const titles = new Map<string, string>();
  for (const group of workspaceStore.groups) {
    for (const session of group.sessions) {
      if (!session.archived) {
        titles.set(session.id, session.title);
      }
    }
  }
  return Object.entries(byId.value)
    .filter(([, status]) => status === "running")
    .map(([id]) => ({ id, title: titles.get(id) ?? id }));
});

const label = computed(() =>
  running.value.length ? t("shell.agentsRunning", { n: running.value.length }) : t("shell.agentsIdle"),
);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-8 gap-1.5 rounded-[var(--radius-md)] px-2 text-[12px] font-normal text-[var(--color-mut)] tabular-nums hover:text-[var(--color-txt)]"
        :aria-label="label"
        :title="label"
      >
        <Activity class="size-3.5 flex-none" aria-hidden="true" />
        <span class="max-w-[190px] truncate">{{ label }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-[288px] p-2">
      <DropdownMenuLabel class="px-1.5 text-[12px] text-[var(--color-mut)]">
        {{ t("shell.systemInfoTitle") }}
      </DropdownMenuLabel>
      <p v-if="!running.length" class="m-0 px-1.5 py-2 text-[12px] text-[var(--color-dim)]">
        {{ t("shell.systemInfoEmpty") }}
      </p>
      <DropdownMenuItem v-for="item in running" :key="item.id" class="gap-2 text-[12px]" disabled>
        <LoaderCircle class="size-3.5 flex-none animate-spin text-[var(--color-accent)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2 text-[12px]" @select="pageStore.open('fleet')">
        {{ t("shell.systemInfoOpenBoard") }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
