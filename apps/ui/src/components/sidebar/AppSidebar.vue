<script setup lang="ts">
import { FolderOpen, Home, Pin, Plus, Search, Sparkles, Cable, Globe } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import SkillsDialog from "@/components/sidebar/SkillsDialog.vue";
import McpDialog from "@/components/sidebar/McpDialog.vue";
import SessionRow from "@/components/sidebar/SessionRow.vue";
import UserBlock from "@/components/sidebar/UserBlock.vue";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const { sessionId } = storeToRefs(chatStore);
const { groups, activeId } = storeToRefs(workspaceStore);

const skillsOpen = ref(false);
const mcpOpen = ref(false);
const filter = ref("");
const pendingSessionDelete = ref<SessionRecord | null>(null);

const workspaceGroups = computed(() =>
  groups.value.filter((item) => !item.archived && item.kind === "workspace"),
);

const commonGroup = computed(() => groups.value.find((item) => item.id === "common") ?? null);

/** 当前会话所在分组 id：自动展开该组，便于定位 */
const activeSessionGroupId = computed(() => {
  const id = sessionId.value;
  if (!id) {
    return activeId.value;
  }
  for (const group of groups.value) {
    if (group.sessions.some((item) => item.id === id)) {
      return group.id;
    }
  }
  return activeId.value;
});

function matchesFilter(session: SessionRecord): boolean {
  const q = filter.value.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return session.title.toLowerCase().includes(q);
}

function sortSessions(list: SessionRecord[]): SessionRecord[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function groupSessions(group: WorkspaceGroup): SessionRecord[] {
  return sortSessions(
    workspaceStore.visibleSessions(group).filter((item) => !item.archived && matchesFilter(item)),
  );
}

function groupOpen(id: string): boolean {
  if (filter.value.trim()) {
    return true;
  }
  // 当前会话所在组始终展开
  if (id === activeSessionGroupId.value) {
    return true;
  }
  return !workspaceStore.isCollapsed(id);
}

function onGroupToggle(id: string) {
  if (filter.value.trim()) {
    return;
  }
  if (id === activeSessionGroupId.value) {
    // 当前组允许手动折叠，但切回会话时会再次展开
    workspaceStore.toggleCollapsed(id);
    return;
  }
  const willOpen = workspaceStore.isCollapsed(id);
  workspaceStore.toggleCollapsed(id);
  if (willOpen) {
    workspaceStore.setActive(id);
  }
}

function groupActive(id: string): boolean {
  return id === activeSessionGroupId.value;
}

async function openSession(record: SessionRecord) {
  for (const group of groups.value) {
    if (group.sessions.some((item) => item.id === record.id)) {
      workspaceStore.setActive(group.id);
      break;
    }
  }
  await chatStore.loadSession(record);
}

async function onNewSessionIn(workspaceId: string) {
  workspaceStore.setActive(workspaceId);
  if (workspaceStore.isCollapsed(workspaceId)) {
    workspaceStore.toggleCollapsed(workspaceId);
  }
  await chatStore.newTask(workspaceId);
}

async function onPinSession(session: SessionRecord) {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  await zen.session.pin(session.id, !session.pinned);
  workspaceStore.pinSessionLocal(session.id, !session.pinned);
}

async function onArchiveSession(session: SessionRecord, archived: boolean) {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  await zen.session.archive(session.id, archived);
  workspaceStore.archiveSessionLocal(session.id, archived);
}

async function onDeleteSession() {
  const session = pendingSessionDelete.value;
  pendingSessionDelete.value = null;
  if (!session) {
    return;
  }
  if (sessionId.value === session.id) {
    await chatStore.newTask();
  }
  await window.zen?.session.remove(session.id);
  workspaceStore.removeSessionLocal(session.id);
}

const sectionLabelCls =
  "flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-medium tracking-wide text-[var(--color-dim)]";

const groupRowCls = (active: boolean) =>
  cn(
    "group/row flex h-8 items-center gap-1 rounded-[var(--radius-sm)] pr-1",
    active
      ? "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)]"
      : "hover:bg-[var(--color-side-hover)] text-[var(--color-side-item)] hover:text-[var(--color-txt-strong)]",
  );

const navBtnCls =
  "flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-left text-[12.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]";
</script>

<template>
  <aside
    class="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--color-side)]"
    aria-label="侧边栏"
  >
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center gap-0.5 px-1.5 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
      <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span class="text-[14px] font-semibold tracking-tight text-[var(--color-txt-strong)]">Zen</span>
        <span
          class="rounded-full bg-[var(--color-menu-active)] px-1.5 py-px text-[10px] leading-4 text-[var(--color-mut)]"
        >
          Beta
        </span>
      </div>
    </header>

    <div class="flex flex-col gap-1 px-2 pb-1 pt-1">
      <Button variant="ghost" :class="[navBtnCls, 'font-normal dark:hover:bg-[var(--color-side-hover)]']" @click="chatStore.newTask()">
        <Plus class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        <span>新建任务</span>
      </Button>
      <Button variant="ghost" :class="[navBtnCls, 'font-normal dark:hover:bg-[var(--color-side-hover)]']" @click="skillsOpen = true">
        <Sparkles class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        <span>技能</span>
      </Button>
      <Button variant="ghost" :class="[navBtnCls, 'font-normal dark:hover:bg-[var(--color-side-hover)]']" @click="mcpOpen = true">
        <Cable class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        <span>MCP</span>
      </Button>
    </div>

    <div class="px-2 pb-1">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-dim)]"
          aria-hidden="true"
        />
        <Input
          v-model="filter"
          class="h-8 pl-7 text-[12px] bg-[var(--color-sunken,#1c1c1c)] border-[var(--color-line-soft)]"
          placeholder="筛选会话"
          aria-label="筛选会话"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <!-- 公共区 -->
      <div v-if="commonGroup" class="px-2">
        <div :class="sectionLabelCls">
          <Globe class="size-3" aria-hidden="true" />
          公共区
          <span class="ml-auto text-[10px] tabular-nums text-[var(--color-dim)]">
            {{ groupSessions(commonGroup).length }}
          </span>
        </div>
        <div :class="groupRowCls(groupActive('common'))">
          <Button
            variant="ghost"
            class="h-full flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
            :aria-expanded="groupOpen('common')"
            @click="onGroupToggle('common')"
          >
            <Home
              class="size-3.5 flex-none"
              :class="groupActive('common') ? 'text-[var(--color-mut)]' : 'text-[var(--color-dim)]'"
              aria-hidden="true"
            />
            <span class="truncate font-medium">公共会话</span>
            <span
              v-if="groupActive('common')"
              class="ml-auto text-[10px] text-[var(--color-mut)]"
            >当前组</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-[var(--color-mut)] opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-transparent!"
            aria-label="在公共区新建会话"
            title="新建会话"
            @click="onNewSessionIn('common')"
          >
            <Plus class="size-3.5" />
          </Button>
        </div>
        <div v-if="groupOpen('common')" class="mt-0.5 flex flex-col gap-0.5">
          <p
            v-if="!groupSessions(commonGroup).length"
            class="m-0 px-2 py-2 text-[11.5px] text-[var(--color-dim)]"
          >
            暂无会话
          </p>
          <SessionRow
            v-for="session in groupSessions(commonGroup)"
            :key="session.id"
            :session="session"
            :active="sessionId === session.id"
            :in-active-group="groupActive('common')"
            @open="openSession(session)"
            @pin="onPinSession(session)"
            @archive="onArchiveSession(session, $event)"
            @remove="pendingSessionDelete = session"
          />
        </div>
      </div>

      <!-- 工作区 -->
      <div class="px-2">
        <div :class="sectionLabelCls">
          <FolderOpen class="size-3" aria-hidden="true" />
          工作区
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 text-[var(--color-mut)] hover:bg-transparent!"
            aria-label="新建工作区"
            title="新建工作区（选择目录）"
            @click="workspaceStore.create()"
          >
            <Plus class="size-3.5" />
          </Button>
        </div>

        <div v-if="!workspaceGroups.length" class="px-2 py-2 text-[11.5px] text-[var(--color-dim)]">
          尚无项目工作区。点右上角 + 添加项目目录。
        </div>

        <div v-for="group in workspaceGroups" :key="group.id" class="mb-0.5">
          <div :class="groupRowCls(groupActive(group.id))">
            <Button
              variant="ghost"
              class="h-full flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
              :aria-expanded="groupOpen(group.id)"
              :aria-label="`${group.name}`"
              @click="onGroupToggle(group.id)"
            >
              <FolderOpen
                v-if="groupOpen(group.id)"
                class="size-3.5 flex-none"
                :class="groupActive(group.id) ? 'text-[var(--color-mut)]' : 'text-[var(--color-dim)]'"
                aria-hidden="true"
              />
              <span
                v-else
                class="size-3.5 flex-none rounded-[3px] border border-[var(--color-line-strong)]"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate" :class="groupActive(group.id) ? 'font-semibold' : 'font-medium'">
                {{ group.name }}
              </span>
              <Pin
                v-if="group.pinned"
                class="size-3 flex-none -rotate-45 text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
                {{ groupSessions(group).length }}
              </span>
              <span
                v-if="groupActive(group.id)"
                class="flex-none text-[10px] text-[var(--color-mut)]"
              >当前组</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-[var(--color-mut)] opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-transparent!"
              :aria-label="`在 ${group.name} 新建会话`"
              title="新建会话"
              @click="onNewSessionIn(group.id)"
            >
              <Plus class="size-3.5" />
            </Button>
          </div>

          <div v-if="groupOpen(group.id)" class="mt-0.5 flex flex-col gap-0.5">
            <p
              v-if="!groupSessions(group).length"
              class="m-0 px-2 py-2 text-[11.5px] text-[var(--color-dim)]"
            >
              该工作区暂无会话
            </p>
            <SessionRow
              v-for="session in groupSessions(group)"
              :key="session.id"
              :session="session"
              :active="sessionId === session.id"
              :in-active-group="groupActive(group.id)"
              @open="openSession(session)"
              @pin="onPinSession(session)"
              @archive="onArchiveSession(session, $event)"
              @remove="pendingSessionDelete = session"
            />
            <Button
              v-if="group.sessions.filter((item) => !item.archived).length > workspaceStore.PREVIEW_COUNT"
              variant="ghost"
              class="h-7 flex w-full items-center rounded-[var(--radius-sm)] px-8 text-left text-[11px] font-normal text-[var(--color-dim)] hover:text-[var(--color-mut)] hover:bg-transparent dark:hover:bg-transparent"
              @click="workspaceStore.toggleExpanded(group.id)"
            >
              {{ workspaceStore.expanded.has(group.id) ? "收起列表" : `展开全部 ${group.sessions.filter((item) => !item.archived).length} 条` }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-none border-t border-[var(--color-line-soft)] p-2">
      <UserBlock />
    </div>

    <ConfirmDialog
      :open="!!pendingSessionDelete"
      :title="`删除会话「${pendingSessionDelete?.title ?? ''}」？`"
      description="会话的消息与记录会被一并删除，操作不可撤销。"
      confirm-label="删除会话"
      cancel-label="保留"
      @update:open="pendingSessionDelete = null"
      @confirm="onDeleteSession"
    />

    <SkillsDialog v-model:open="skillsOpen" />
    <McpDialog v-model:open="mcpOpen" />
  </aside>
</template>
