<script setup lang="ts">
import {
  Archive,
  Bell,
  Cable,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  MoreHorizontal,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
} from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import SessionRow from "@/components/sidebar/SessionRow.vue";
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

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();

const platformLabels = ref({
  platform: "darwin" as "darwin" | "win32" | "linux",
  showInFolderLabel: "在 Finder 中显示",
  openFolderLabel: "打开文件夹",
});
const copiedPathId = ref("");

onMounted(async () => {
  const info = await window.zen?.shell?.platformInfo();
  if (info) {
    platformLabels.value = info;
  }
});

async function copyPath(group: WorkspaceGroup) {
  const path = group.path;
  if (!path) {
    return;
  }
  try {
    await navigator.clipboard.writeText(path);
    copiedPathId.value = group.id;
    setTimeout(() => {
      if (copiedPathId.value === group.id) {
        copiedPathId.value = "";
      }
    }, 1200);
  } catch {
    // ignore
  }
}

function showInFolder(group: WorkspaceGroup) {
  if (group.path) {
    void window.zen?.shell?.showInFolder(group.path);
  }
}

function openFolder(group: WorkspaceGroup) {
  if (group.path) {
    void window.zen?.shell?.openPath(group.path);
  }
}

const actions = [
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
  "group/head flex items-center gap-1 px-3.5 pt-4 pb-1.5 text-[11.5px] text-[var(--color-dim)]";
const headerBtnCls =
  "text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]";
const groupRowCls =
  "group/row flex h-9 items-center gap-1 rounded-[var(--radius-sm)] pr-1 hover:bg-[var(--color-side-hover)]";
/** 行内操作：默认隐藏，悬停行时淡入；尺寸统一 icon-sm */
const addActionCls =
  "text-[var(--color-mut)] opacity-0 hover:text-[var(--color-txt-strong)] group-hover/row:opacity-100 group-hover/head:opacity-100 focus-visible:opacity-100";

const pendingDelete = ref<WorkspaceGroup | null>(null);
const pendingSessionDelete = ref<SessionRecord | null>(null);
/** 已归档会话分区展开状态（按组记录） */
const archivedOpen = ref(new Set<string>());

/** 目录工作区（未归档） */
const workspaceGroups = computed(() =>
  workspaceStore.groups.filter((item) => !item.archived && item.kind === "workspace"),
);

/** 公共区作为顶级项，与工作区同级 */
const commonGroup = computed(
  () => workspaceStore.groups.find((item) => item.id === "common") ?? null,
);

function activeSessions(group: WorkspaceGroup) {
  return workspaceStore.visibleSessions(group).filter((item) => !item.archived);
}

function archivedSessions(group: WorkspaceGroup) {
  return group.sessions.filter((item) => item.archived);
}

function toggleArchived(groupId: string) {
  const next = new Set(archivedOpen.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  archivedOpen.value = next;
}

/** 目录是否展开（未折叠时才显示会话列表） */
function groupOpen(id: string) {
  return !workspaceStore.isCollapsed(id);
}

/** 点整行：折叠态则展开并设为当前；已展开则折叠 */
function onGroupRowClick(id: string) {
  const willOpen = workspaceStore.isCollapsed(id);
  workspaceStore.toggleCollapsed(id);
  if (willOpen) {
    workspaceStore.setActive(id);
  }
}

function iconCls(active: boolean) {
  return cn("size-4 flex-none", active ? "text-[var(--color-mut)]" : "text-[var(--color-dim)]");
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

async function onNewSessionIn(workspaceId: string) {
  workspaceStore.setActive(workspaceId);
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
  if (chatStore.sessionId === session.id) {
    await chatStore.newTask();
  }
  await window.zen?.session.remove(session.id);
  workspaceStore.removeSessionLocal(session.id);
}

function confirmWorkspaceDelete() {
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
        class="text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]"
        aria-label="收起侧栏"
        title="收起侧栏"
        @click="layoutStore.toggleLeft()"
      >
        <PanelLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]"
        aria-label="搜索"
        title="搜索"
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]"
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
        <button type="button" :class="navCls" @click="chatStore.newTask()">
          <CircleDot class="size-4 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          <span>新建任务</span>
        </button>
        <button
          v-for="item in actions"
          :key="item.id"
          type="button"
          :class="navCls"
          @click="emit('action', item.id)"
        >
          <component :is="item.icon" class="size-4 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </div>

      <!-- 公共区：顶级项，与工作区同级 -->
      <div v-if="commonGroup" :class="sectionCls" class="pt-3">
        <div :class="groupRowCls">
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:text-[var(--color-txt-strong)]"
            :aria-expanded="groupOpen('common')"
            @click="onGroupRowClick('common')"
          >
            <Globe
              :class="iconCls(workspaceStore.activeId === 'common')"
              aria-hidden="true"
            />
            <span class="truncate">公共区</span>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="addActionCls"
            aria-label="在公共区新建会话"
            title="新建会话"
            @click.stop="onNewSessionIn('common')"
          >
            <Plus class="size-4" />
          </Button>
        </div>
        <template v-if="groupOpen('common')">
          <SessionRow
            v-for="session in activeSessions(commonGroup)"
            :key="session.id"
            :session="session"
            :active="chatStore.sessionId === session.id"
            @open="openSession(session.id)"
            @pin="onPinSession(session)"
            @archive="onArchiveSession(session, $event)"
            @remove="pendingSessionDelete = session"
          />
          <button
            v-if="archivedSessions(commonGroup).length"
            type="button"
            class="flex h-7 w-full items-center gap-1 rounded-[var(--radius-sm)] pl-[38px] pr-2 text-left text-[11.5px] text-[var(--color-dim)] hover:text-[var(--color-mut)]"
            @click="toggleArchived('common')"
          >
            <ChevronDown
              class="size-3"
              :class="archivedOpen.has('common') ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            已归档会话 {{ archivedSessions(commonGroup).length }}
          </button>
          <template v-if="archivedOpen.has('common')">
            <SessionRow
              v-for="session in archivedSessions(commonGroup)"
              :key="session.id"
              :session="session"
              :active="chatStore.sessionId === session.id"
              :depth="2"
              @open="openSession(session.id)"
              @pin="onPinSession(session)"
              @archive="onArchiveSession(session, $event)"
              @remove="pendingSessionDelete = session"
            />
          </template>
        </template>
      </div>

      <div :class="headCls">
        工作区
        <Button
          variant="ghost"
          size="icon-sm"
          class="ml-auto"
          :class="addActionCls"
          aria-label="新建工作区"
          title="新建工作区（选择目录）"
          @click="workspaceStore.create()"
        >
          <Plus class="size-4" />
        </Button>
      </div>

      <div :class="sectionCls">
        <div v-for="group in workspaceGroups" :key="group.id" class="flex flex-col gap-0.5">
          <div :class="groupRowCls">
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:text-[var(--color-txt-strong)]"
              :aria-expanded="groupOpen(group.id)"
              :aria-label="`${group.name}，${groupOpen(group.id) ? '折叠' : '展开'}会话`"
              @click="onGroupRowClick(group.id)"
            >
              <FolderOpen
                v-if="groupOpen(group.id)"
                :class="iconCls(workspaceStore.activeId === group.id)"
                aria-hidden="true"
              />
              <Folder
                v-else
                :class="iconCls(workspaceStore.activeId === group.id)"
                aria-hidden="true"
              />
              <span class="truncate">{{ group.name }}</span>
              <Pin
                v-if="group.pinned"
                class="size-3 flex-none -rotate-45 text-[var(--color-accent)]"
                aria-hidden="true"
              />
            </button>
            <div class="flex flex-none items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                :class="addActionCls"
                :aria-label="`在 ${group.name} 新建会话`"
                title="新建会话"
                @click="onNewSessionIn(group.id)"
              >
                <Plus class="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    type="button"
                    class="flex size-7 flex-none items-center justify-center rounded text-[var(--color-mut)] opacity-0 hover:text-[var(--color-txt)] group-hover/row:opacity-100 focus-visible:opacity-100"
                    aria-label="工作区操作"
                  >
                    <MoreHorizontal class="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="min-w-[180px]">
                  <DropdownMenuItem @select="copyPath(group)">
                    <Check v-if="copiedPathId === group.id" class="size-3.5" />
                    <Copy v-else class="size-3.5" />
                    {{ copiedPathId === group.id ? "已复制路径" : "复制路径" }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="showInFolder(group)">
                    <FolderSearch class="size-3.5" />
                    {{ platformLabels.showInFolderLabel }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="openFolder(group)">
                    <FolderOpen class="size-3.5" />
                    {{ platformLabels.openFolderLabel }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="workspaceStore.pin(group.id, !group.pinned)">
                    <Pin v-if="!group.pinned" class="size-3.5" />
                    <PinOff v-else class="size-3.5" />
                    {{ group.pinned ? "取消置顶" : "置顶" }}
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
          </div>

          <template v-if="groupOpen(group.id)">
            <SessionRow
              v-for="session in activeSessions(group)"
              :key="session.id"
              :session="session"
              :active="chatStore.sessionId === session.id"
              @open="openSession(session.id)"
              @pin="onPinSession(session)"
              @archive="onArchiveSession(session, $event)"
              @remove="pendingSessionDelete = session"
            />
            <button
              v-if="group.sessions.filter((item) => !item.archived).length > workspaceStore.PREVIEW_COUNT"
              type="button"
              class="flex h-7 w-full items-center rounded-[var(--radius-sm)] pl-[38px] pr-2 text-left text-[11.5px] text-[var(--color-dim)] hover:text-[var(--color-mut)]"
              @click="workspaceStore.toggleExpanded(group.id)"
            >
              {{ workspaceStore.expanded.has(group.id) ? "收起" : "展开显示" }}
            </button>
            <button
              v-if="archivedSessions(group).length"
              type="button"
              class="flex h-7 w-full items-center gap-1 rounded-[var(--radius-sm)] pl-[38px] pr-2 text-left text-[11.5px] text-[var(--color-dim)] hover:text-[var(--color-mut)]"
              @click="toggleArchived(group.id)"
            >
              <ChevronDown
                class="size-3"
                :class="archivedOpen.has(group.id) ? '' : '-rotate-90'"
                aria-hidden="true"
              />
              已归档会话 {{ archivedSessions(group).length }}
            </button>
            <template v-if="archivedOpen.has(group.id)">
              <SessionRow
                v-for="session in archivedSessions(group)"
                :key="session.id"
                :session="session"
                :active="chatStore.sessionId === session.id"
                :depth="2"
                @open="openSession(session.id)"
                @pin="onPinSession(session)"
                @archive="onArchiveSession(session, $event)"
                @remove="pendingSessionDelete = session"
              />
            </template>
          </template>
        </div>
      </div>

      <template v-if="workspaceStore.archivedGroups.length">
        <div :class="headCls">
          <Archive class="size-3" aria-hidden="true" />
          已归档工作区
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
                  class="mr-1 flex size-6 flex-none items-center justify-center rounded text-[var(--color-dim)] hover:text-[var(--color-txt)]"
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
      @confirm="confirmWorkspaceDelete"
    />

    <ConfirmDialog
      :open="!!pendingSessionDelete"
      :title="`删除会话「${pendingSessionDelete?.title ?? ''}」？`"
      description="会话的消息与记录会被一并删除，操作不可撤销。"
      confirm-label="删除会话"
      cancel-label="保留"
      @update:open="pendingSessionDelete = null"
      @confirm="onDeleteSession"
    />

    <div class="p-2">
      <UserBlock />
    </div>
  </aside>
</template>
