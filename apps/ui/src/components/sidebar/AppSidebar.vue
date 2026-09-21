<script setup lang="ts">
import { FolderOpen, Pin, Plus, Search, Sparkles, Cable, Globe } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import SkillsDialog from "@/components/sidebar/SkillsDialog.vue";
import McpDialog from "@/components/sidebar/McpDialog.vue";
import SessionRow from "@/components/sidebar/SessionRow.vue";
import UserBlock from "@/components/sidebar/UserBlock.vue";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const { sessionId } = storeToRefs(chatStore);
const { groups } = storeToRefs(workspaceStore);

const skillsOpen = ref(false);
const mcpOpen = ref(false);
const filter = ref("");
const pendingSessionDelete = ref<SessionRecord | null>(null);

const workspaceGroups = computed(() =>
  groups.value.filter((item) => !item.archived && item.kind === "workspace"),
);

const commonGroup = computed(() => groups.value.find((item) => item.id === "common") ?? null);

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
  return !workspaceStore.isCollapsed(id);
}

function onGroupToggle(id: string) {
  if (filter.value.trim()) {
    return;
  }
  const willOpen = workspaceStore.isCollapsed(id);
  workspaceStore.toggleCollapsed(id);
  // 展开某个分组时顺带把它设为当前工作区（新建任务默认落点）
  if (willOpen) {
    workspaceStore.setActive(id);
  }
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

/** 分组标题：图标与下方按钮图标同列（容器 8px + 按钮边框 1px + 内边距 8px = 图标列 17px），文字与按钮文字同列（39px，17 + 14 图标 + 8 间距） */
const sectionLabelCls =
  "group/section flex items-center gap-2 pl-[9px] pr-3 pb-1 pt-3 text-[12px] font-medium tracking-wide text-[var(--color-mut)]";

/** 分组行：不做选中高亮（高亮只落在会话上），仅保留 hover 反馈 */
const groupRowCls =
  "group/row flex h-8 items-center gap-1 rounded-[var(--radius-sm)] pr-1 text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]";

/** 顶部导航：内容左对齐（覆盖 Button 基类 justify-center），图标列/文字列与下方分组行对齐（17px/39px） */
const navBtnCls =
  "flex h-8 w-full items-center justify-start gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[12.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]";
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
          class="pointer-events-none absolute left-[9px] top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-dim)]"
          aria-hidden="true"
        />
        <Input
          v-model="filter"
          class="h-8 pl-[31px] text-[12px] bg-[var(--color-sunken,#1c1c1c)] border-[var(--color-line-soft)]"
          placeholder="筛选会话"
          aria-label="筛选会话"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <!-- 公共区：单层分组（原「公共区」节头 +「公共会话」组行两层重叠，合并为一层） -->
      <div v-if="commonGroup" class="px-2">
        <div :class="groupRowCls">
          <Button
            variant="ghost"
            class="h-full flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
            :aria-expanded="groupOpen('common')"
            aria-label="公共区会话"
            @click="onGroupToggle('common')"
          >
            <Globe
              class="size-3.5 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium">公共区</span>
            <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
              {{ groupSessions(commonGroup).length }}
            </span>
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
          <FolderOpen class="size-3.5" aria-hidden="true" />
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
          <div :class="groupRowCls">
            <Button
              variant="ghost"
              class="h-full flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
              :aria-expanded="groupOpen(group.id)"
              :aria-label="`${group.name}`"
              @click="onGroupToggle(group.id)"
            >
              <FolderOpen
                v-if="groupOpen(group.id)"
                class="size-3.5 flex-none text-[var(--color-dim)]"
                aria-hidden="true"
              />
              <span
                v-else
                class="size-3.5 flex-none rounded-[3px] border border-[var(--color-line-strong)]"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate font-medium">
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
