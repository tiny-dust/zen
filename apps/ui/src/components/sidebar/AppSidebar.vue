<script setup lang="ts">
import {
  Archive,
  Bell,
  Cable,
  CircleDot,
  Folder,
  Globe,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
} from "@lucide/vue";
import { classes } from "rattail";
import { computed, ref } from "vue";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import UserBlock from "@/components/sidebar/UserBlock.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useWorkspaceStore } from "@/stores/workspace";

import type { WorkspaceGroup } from "@zen/shared";

const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();

const actions = [
  { id: "new-task", label: "新建任务", icon: CircleDot },
  { id: "skills", label: "技能", icon: Sparkles },
  { id: "mcp", label: "MCP", icon: Cable },
];

const emit = defineEmits<{
  action: [id: string];
}>();

const navCls =
  "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]";
const sectionCls = "flex flex-col gap-0.5 px-2";
const headCls =
  "flex items-center gap-1 px-3.5 pt-4 pb-1.5 text-[11.5px] text-[var(--color-dim)]";
const headerBtnCls =
  "text-[var(--color-topbar-icon)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]";
const sessionCls =
  "flex h-8 w-full items-center rounded-[var(--radius-sm)] pl-[38px] pr-2 text-left text-[12.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]";
const expandCls =
  "flex h-7 w-full items-center rounded-[var(--radius-sm)] pl-[38px] pr-2 text-left text-[11.5px] text-[var(--color-dim)] hover:text-[var(--color-mut)]";

const pendingDelete = ref<WorkspaceGroup | null>(null);

/** 未归档分组（公共区排最前） */
const visibleGroups = computed(() => {
  const sorted = [...workspaceStore.groups.filter((item) => !item.archived)];
  sorted.sort((a, b) => (a.kind === "common" ? -1 : b.kind === "common" ? 1 : 0));
  return sorted;
});

function isSessionActive(id: string) {
  return chatStore.sessionId === id;
}

function sessionRowCls(id: string) {
  return classes(
    sessionCls,
    [isSessionActive(id), "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)]"],
  );
}

function groupRowCls(id: string) {
  return classes(
    navCls,
    "group/row pr-1",
    [workspaceStore.activeId === id, "text-[var(--color-txt-strong)]"],
  );
}

function iconCls(active: boolean) {
  return cn("size-4 flex-none", active ? "text-[var(--color-mut)]" : "text-[var(--color-dim)]");
}

async function onNewTask() {
  emit("action", "new-task");
  await chatStore.newTask();
}

async function openSession(id: string) {
  for (const group of workspaceStore.groups) {
    const record = group.sessions.find((item) => item.id === id);
    if (record) {
      await chatStore.loadSession(record);
      return;
    }
  }
}

function confirmDelete() {
  if (pendingDelete.value) {
    void workspaceStore.remove(pendingDelete.value.id);
  }
  pendingDelete.value = null;
}
</script>

<template>
  <aside
    class="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--color-side)]"
    aria-label="侧边栏"
  >
    <!-- 头行：窗口 chrome，与交通灯同行 -->
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center gap-0.5 px-1.5 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
      <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="收起侧栏"
        title="收起侧栏"
        @click="layoutStore.toggleLeft()"
      >
        <PanelLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="搜索"
        title="搜索"
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="通知"
        title="通知"
      >
        <Bell />
      </Button>
    </header>

    <div class="flex items-center gap-2 px-4 pb-1 pt-2.5">
      <span class="text-[15px] font-bold tracking-tight text-[var(--color-txt-strong)]">Zen</span>
      <span
        class="rounded-full bg-[var(--color-side-sel)] px-1.5 py-px text-[10px] leading-4 text-[var(--color-mut)]"
      >
        Beta
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div :class="sectionCls" class="pt-1.5">
        <button
          v-for="item in actions"
          :key="item.id"
          type="button"
          :class="navCls"
          @click="item.id === 'new-task' ? onNewTask() : emit('action', item.id)"
        >
          <component :is="item.icon" :class="iconCls(false)" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </div>

      <div :class="headCls">
        工作区
        <Button
          variant="ghost"
          size="icon-xs"
          class="ml-auto text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
          aria-label="新建工作区"
          title="新建工作区（选择目录）"
          @click="workspaceStore.create()"
        >
          <Plus />
        </Button>
      </div>

      <div :class="sectionCls">
        <div v-for="group in visibleGroups" :key="group.id" class="flex flex-col gap-0.5">
          <div :class="cn('group/row flex h-9 items-center gap-2.5 rounded-[var(--radius-sm)] pr-1 hover:bg-[var(--color-side-hover)]', workspaceStore.activeId === group.id && 'bg-[var(--color-side-sel)]')">
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:text-[var(--color-txt-strong)]"
              @click="workspaceStore.setActive(group.id)"
            >
              <Globe
                v-if="group.kind === 'common'"
                :class="iconCls(workspaceStore.activeId === group.id)"
                aria-hidden="true"
              />
              <Folder v-else :class="iconCls(workspaceStore.activeId === group.id)" aria-hidden="true" />
              <span class="truncate">{{ group.name }}</span>
            </button>
            <DropdownMenu v-if="group.kind === 'workspace'">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="flex size-6 flex-none items-center justify-center rounded text-[var(--color-dim)] opacity-0 hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)] group-hover/row:opacity-100"
                  aria-label="工作区操作"
                >
                  <MoreHorizontal class="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-[140px]">
                <DropdownMenuItem @select="workspaceStore.setActive(group.id)">
                  指定为当前
                </DropdownMenuItem>
                <DropdownMenuItem @select="workspaceStore.archive(group.id, true)">
                  归档
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="text-[var(--color-danger-fg)]"
                  @select="pendingDelete = group"
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            v-for="session in workspaceStore.visibleSessions(group)"
            :key="session.id"
            type="button"
            :class="sessionRowCls(session.id)"
            @click="openSession(session.id)"
          >
            <span class="truncate">{{ session.title }}</span>
          </button>
          <button
            v-if="group.sessions.length > workspaceStore.PREVIEW_COUNT"
            type="button"
            :class="expandCls"
            @click="workspaceStore.toggleExpanded(group.id)"
          >
            {{ workspaceStore.expanded.has(group.id) ? "收起" : "展开显示" }}
          </button>
        </div>
      </div>

      <template v-if="workspaceStore.archivedGroups.length">
        <div :class="headCls">
          <Archive class="size-3" aria-hidden="true" />
          已归档
        </div>
        <div :class="sectionCls">
          <div
            v-for="group in workspaceStore.archivedGroups"
            :key="group.id"
            class="flex h-8 items-center gap-1 rounded-[var(--radius-sm)] pl-2.5 hover:bg-[var(--color-side-hover)]"
          >
            <span class="flex min-w-0 flex-1 items-center gap-2.5 text-[13px] text-[var(--color-dim)]">
              <Folder class="size-4 flex-none" aria-hidden="true" />
              <span class="truncate">{{ group.name }}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="mr-1 flex size-6 flex-none items-center justify-center rounded text-[var(--color-dim)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]"
                  aria-label="归档工作区操作"
                >
                  <MoreHorizontal class="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-[140px]">
                <DropdownMenuItem @select="workspaceStore.archive(group.id, false)">
                  取消归档
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="text-[var(--color-danger-fg)]"
                  @select="pendingDelete = group"
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="`删除工作区「${pendingDelete?.name ?? ''}」？`"
      description="工作区下的所有会话与聊天记录会被一并删除，目录本身不受影响，操作不可撤销。"
      confirm-label="删除工作区"
      cancel-label="保留"
      @update:open="pendingDelete = null"
      @confirm="confirmDelete"
    />

    <div class="p-2">
      <UserBlock />
    </div>
  </aside>
</template>
