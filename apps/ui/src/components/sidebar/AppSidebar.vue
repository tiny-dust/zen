<script setup lang="ts">
import { Cable, ChevronDown, Folder, FolderPlus, Plus, Sparkles } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import SkillsDialog from "@/components/sidebar/SkillsDialog.vue";
import McpDialog from "@/components/sidebar/McpDialog.vue";
import ProjectSessionGroup from "@/components/sidebar/ProjectSessionGroup.vue";
import UserBlock from "@/components/sidebar/UserBlock.vue";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { AcceptableValue } from "reka-ui";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const { sessionId } = storeToRefs(chatStore);
const { groups } = storeToRefs(workspaceStore);

const skillsOpen = ref(false);
const mcpOpen = ref(false);
const pendingSessionDelete = ref<SessionRecord | null>(null);
/** 工作区右键：重命名弹窗与删除确认 */
const renamingWorkspace = ref<WorkspaceGroup | null>(null);
const renameDraft = ref("");
const pendingWorkspaceDelete = ref<WorkspaceGroup | null>(null);
/** 「项目」下拉：all = 全部项目，否则只显示选中项目（切换/筛选） */
const projectFilter = ref("all");
/** 「在文件管理器中显示」按平台文案（Windows 资源管理器 / Linux 文件管理器） */
const showInFolderLabel = ref("在 Finder 中显示");

onMounted(async () => {
  const info = window.zen ? await window.zen.shell.platformInfo() : null;
  if (info?.showInFolderLabel) {
    showInFolderLabel.value = info.showInFolderLabel;
  }
});

const workspaceGroups = computed(() =>
  groups.value.filter((item) => !item.archived && item.kind === "workspace"),
);

const commonGroup = computed(() => groups.value.find((item) => item.id === "common") ?? null);

/** 分组列表：公共区在前，其后为项目工作区（后端已按置顶/更新时间排序） */
const displayGroups = computed<WorkspaceGroup[]>(() => {
  const visible = groups.value.filter((item) => !item.archived);
  if (projectFilter.value !== "all") {
    return visible.filter((item) => item.id === projectFilter.value);
  }
  const common = visible.filter((item) => item.kind === "common");
  const workspaces = visible.filter((item) => item.kind === "workspace");
  return [...common, ...workspaces];
});

const projectFilterLabel = computed(() => {
  if (projectFilter.value === "all") {
    return "项目";
  }
  return groups.value.find((item) => item.id === projectFilter.value)?.name ?? "项目";
});

function sortSessions(list: SessionRecord[]): SessionRecord[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function sessionsOf(group: WorkspaceGroup): SessionRecord[] {
  return sortSessions(group.sessions.filter((item) => !item.archived));
}

function groupOpen(id: string): boolean {
  return !workspaceStore.isCollapsed(id);
}

function onGroupToggle(id: string) {
  const willOpen = workspaceStore.isCollapsed(id);
  workspaceStore.toggleCollapsed(id);
  // 展开某个分组时顺带把它设为当前工作区（新建任务默认落点）
  if (willOpen) {
    workspaceStore.setActive(id);
  }
}

/** 「项目」下拉选中：单项目时过滤列表并切为当前工作区 */
function onSelectProject(value: AcceptableValue) {
  const id = typeof value === "string" ? value : "all";
  projectFilter.value = id;
  if (id !== "all") {
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

/** 工作区右键菜单动作 */
function beginRenameWorkspace(group: WorkspaceGroup) {
  renamingWorkspace.value = group;
  renameDraft.value = group.name;
}

async function commitRenameWorkspace() {
  const group = renamingWorkspace.value;
  renamingWorkspace.value = null;
  const next = renameDraft.value.trim();
  if (group && next && next !== group.name) {
    await workspaceStore.rename(group.id, next);
  }
}

async function onCopyWorkspacePath(group: WorkspaceGroup) {
  if (group.path) {
    await navigator.clipboard.writeText(group.path);
  }
}

async function onShowWorkspaceInFolder(group: WorkspaceGroup) {
  if (group.path) {
    await window.zen?.shell.showInFolder(group.path);
  }
}

async function onDeleteWorkspace() {
  const group = pendingWorkspaceDelete.value;
  pendingWorkspaceDelete.value = null;
  if (!group) {
    return;
  }
  if (projectFilter.value === group.id) {
    projectFilter.value = "all";
  }
  await workspaceStore.remove(group.id);
}

/** 「项目」下拉触发器：文字 + 下箭头 */
const projectTriggerCls =
  "h-8 w-full justify-start gap-1 rounded-[var(--radius-sm)] px-2 text-left text-[12.5px] font-normal text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)] dark:hover:bg-[var(--color-side-hover)]";

const menuItemCls = "gap-2 text-[12.5px] text-[var(--color-txt)]";
const menuIconCls = "size-3.5 flex-none text-[var(--color-mut)]";
</script>

<template>
  <aside
    class="relative flex h-full min-w-0 flex-col overflow-hidden bg-[var(--color-side)]"
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

    <!-- 项目切换/筛选 -->
    <div class="flex-none px-2 pb-1 pt-1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" :class="projectTriggerCls">
            <span class="min-w-0 truncate">{{ projectFilterLabel }}</span>
            <ChevronDown class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          class="w-[var(--reka-dropdown-menu-trigger-width)] min-w-[200px] text-[12.5px]"
        >
          <DropdownMenuRadioGroup
            :model-value="projectFilter"
            @update:model-value="onSelectProject"
          >
            <DropdownMenuRadioItem value="all" :class="menuItemCls">全部项目</DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              v-if="commonGroup"
              :value="commonGroup.id"
              :class="menuItemCls"
            >
              公共区
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              v-for="group in workspaceGroups"
              :key="group.id"
              :value="group.id"
              :class="menuItemCls"
            >
              <Folder :class="menuIconCls" aria-hidden="true" />
              {{ group.name }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem :class="menuItemCls" @select="workspaceStore.create()">
            <FolderPlus :class="menuIconCls" aria-hidden="true" />
            新建工作区
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :class="menuItemCls" @select="skillsOpen = true">
            <Sparkles :class="menuIconCls" aria-hidden="true" />
            技能
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItemCls" @select="mcpOpen = true">
            <Cable :class="menuIconCls" aria-hidden="true" />
            MCP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <ProjectSessionGroup
        v-for="group in displayGroups"
        :key="group.id"
        :group="group"
        :sessions="sessionsOf(group)"
        :open="groupOpen(group.id)"
        :expanded="workspaceStore.expanded.has(group.id)"
        :active-session-id="sessionId"
        :show-in-folder-label="showInFolderLabel"
        @toggle="onGroupToggle(group.id)"
        @toggle-expand="workspaceStore.toggleExpanded(group.id)"
        @new-session="onNewSessionIn(group.id)"
        @open="openSession"
        @pin="onPinSession"
        @archive="(session, archived) => onArchiveSession(session, archived)"
        @remove="pendingSessionDelete = $event"
        @pin-workspace="workspaceStore.pin(group.id, !group.pinned)"
        @rename="beginRenameWorkspace(group)"
        @copy-path="onCopyWorkspacePath(group)"
        @show-in-folder="onShowWorkspaceInFolder(group)"
        @delete-workspace="pendingWorkspaceDelete = group"
      />
    </div>

    <!-- 新建会话：悬浮圆形按钮 -->
    <Button
      variant="ghost"
      size="icon-lg"
      class="absolute right-3 bottom-24 z-10 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-composer-surface)] text-[var(--color-txt)] shadow-[var(--shadow-tip)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)] dark:hover:bg-[var(--color-side-hover)]"
      aria-label="新建会话"
      title="新建会话"
      @click="chatStore.newTask()"
    >
      <Plus class="size-4" />
    </Button>

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

    <!-- 工作区右键：重命名（只改侧栏显示名，不动磁盘目录） -->
    <Dialog
      :open="!!renamingWorkspace"
      @update:open="(value: boolean) => { if (!value) renamingWorkspace = null; }"
    >
      <DialogContent
        class="w-[min(380px,calc(100vw-48px))] gap-2 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
        :show-close-button="false"
      >
        <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
          重命名工作区
        </DialogTitle>
        <DialogDescription class="text-[12.5px] text-[var(--color-mut)]">
          只改侧栏显示名，不影响磁盘目录。
        </DialogDescription>
        <Input
          v-model="renameDraft"
          aria-label="工作区名称"
          @keydown.enter="commitRenameWorkspace"
        />
        <DialogFooter class="mt-1 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" @click="renamingWorkspace = null">取消</Button>
          <Button size="sm" @click="commitRenameWorkspace">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 工作区右键：删除（落库级联，需要二次确认） -->
    <ConfirmDialog
      :open="!!pendingWorkspaceDelete"
      :title="`删除工作区「${pendingWorkspaceDelete?.name ?? ''}」？`"
      description="仅从 Zen 移除该目录（磁盘文件不受影响）；其下的会话与消息会一并删除，不可恢复。"
      confirm-label="删除工作区"
      cancel-label="保留"
      @update:open="pendingWorkspaceDelete = null"
      @confirm="onDeleteWorkspace"
    />

    <SkillsDialog v-model:open="skillsOpen" />
    <McpDialog v-model:open="mcpOpen" />
  </aside>
</template>
