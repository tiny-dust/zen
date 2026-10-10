<script setup lang="ts">
  import { Cable, ChevronDown, ChevronRight, FolderClosed, Plus, Sparkles } from "@lucide/vue";
  import { storeToRefs } from "pinia";
  import { computed, onMounted, ref } from "vue";

  import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
  import McpDialog from "@/components/sidebar/McpDialog.vue";
  import ProjectSessionGroup from "@/components/sidebar/ProjectSessionGroup.vue";
  import SkillsDialog from "@/components/sidebar/SkillsDialog.vue";
  import UserBlock from "@/components/sidebar/UserBlock.vue";
  import { Button } from "@/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
  } from "@/components/ui/dialog";
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
  const pendingSessionDelete = ref<SessionRecord | null>(null);
  /** 工作区右键：重命名弹窗与删除确认 */
  const renamingWorkspace = ref<WorkspaceGroup | null>(null);
  const renameDraft = ref("");
  const pendingWorkspaceDelete = ref<WorkspaceGroup | null>(null);
  /** 「在文件管理器中显示」按平台文案（Windows 资源管理器 / Linux 文件管理器） */
  const showInFolderLabel = ref("在 Finder 中显示");

  onMounted(async () => {
    const info = window.zen ? await window.zen.shell.platformInfo() : null;
    if (info?.showInFolderLabel) {
      showInFolderLabel.value = info.showInFolderLabel;
    }
  });

  /** 公共区：顶级分组（组头即区块头） */
  const commonGroup = computed(() =>
    groups.value.find((item) => item.id === "common" && !item.archived) ?? null,
  );

  /** 项目工作区列表（后端已按置顶/更新时间排序） */
  const workspaceGroups = computed(() =>
    groups.value.filter((item) => !item.archived && item.kind === "workspace"),
  );

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
    await workspaceStore.remove(group.id);
  }

  /** 「工作区」区块折叠键：复用工作区分组的同一持久化集合（localStorage） */
  const WORKSPACES_ZONE_KEY = "zone:workspaces";
  /** 工作区区块是否展开（折叠后只显示区块头，隐藏全部目录与目录内会话） */
  const workspacesZoneOpen = computed(() => !workspaceStore.isCollapsed(WORKSPACES_ZONE_KEY));

  function toggleWorkspacesZone() {
    workspaceStore.toggleCollapsed(WORKSPACES_ZONE_KEY);
  }

  /** 顶部常驻入口（技能 / MCP）大卡片：与列表行区隔明显的独立入口 */
  const topCardCls =
    "group flex h-10 w-full items-center gap-2.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-side-hover)] px-3 text-[13px] font-medium text-[var(--color-side-item)] transition-all duration-150 hover:bg-[var(--color-side-active)] hover:text-[var(--color-txt-strong)] active:scale-[0.98]";
</script>

<template>
  <aside class="relative flex h-full justify-between min-w-0 flex-col overflow-hidden bg-[var(--color-side)]"
    aria-label="侧边栏">
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center gap-0.5 px-1.5 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
      <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span class="text-[14px] font-semibold tracking-tight text-[var(--color-txt-strong)]">Zen</span>
      </div>
    </header>

    <div class="flex flex-col flex-1 overflow-y-auto  my-2">
      <!-- 顶部常驻入口：技能 / MCP（大卡片，与下方会话分区拉开层次） -->
      <div class="flex flex-none flex-col gap-1.5 px-2 pt-1.5">
        <Button type="button" :class="topCardCls" @click="skillsOpen = true">
          <Sparkles
            class="size-4 flex-none text-[var(--color-mut)] transition-colors duration-150 group-hover:text-[var(--color-accent)]"
            aria-hidden="true" />
          <span>技能</span>
          <ChevronRight
            class="ml-auto size-3 text-[var(--color-dim)] opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true" />
        </Button>
        <Button type="button" :class="topCardCls" @click="mcpOpen = true">
          <Cable
            class="size-4 flex-none text-[var(--color-mut)] transition-colors duration-150 group-hover:text-[var(--color-accent)]"
            aria-hidden="true" />
          <span>MCP</span>
          <ChevronRight
            class="ml-auto size-3 text-[var(--color-dim)] opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true" />
        </Button>
      </div>

      <!-- 会话分区：公共区 / 工作区（区块头可折叠，pt-3 与顶部入口卡拉开间距） -->
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2 pt-3 mt-10">
        <!-- 公共区：组头即区块头（variant=zone），点击折叠/展开其下会话 -->
        <ProjectSessionGroup v-if="commonGroup" variant="zone" :group="commonGroup" :sessions="sessionsOf(commonGroup)"
          :open="groupOpen(commonGroup.id)" :expanded="workspaceStore.expanded.has(commonGroup.id)"
          :active-session-id="sessionId" :show-in-folder-label="showInFolderLabel"
          @toggle="onGroupToggle(commonGroup.id)" @toggle-expand="workspaceStore.toggleExpanded(commonGroup.id)"
          @new-session="onNewSessionIn(commonGroup.id)" @open="openSession" @pin="onPinSession"
          @archive="(session, archived) => onArchiveSession(session, archived)"
          @remove="pendingSessionDelete = $event" />

        <div class="mx-2.5 h-px flex-none bg-[var(--color-line-soft)]" aria-hidden="true" />

        <!-- 工作区：区块头（可折叠）+ 各项目目录（几何与公共区区块头对齐：h-8 / hover 面同缩进） -->
        <section class="flex flex-col">
          <div class="px-2">
            <div
              class="group/zone flex h-8 items-center gap-2 rounded-[var(--radius-sm)] pr-1 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)]">
              <Button variant="ghost"
                class="h-full flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                :aria-expanded="workspacesZoneOpen" aria-label="工作区" @click="toggleWorkspacesZone">
                <span class="flex size-5 flex-none items-center justify-center rounded-md bg-[var(--color-side-hover)]"
                  aria-hidden="true">
                  <FolderClosed class="size-4 text-[var(--color-mut)]" />
                </span>
                <span class="min-w-0 flex-1 truncate font-semibold text-[var(--color-txt-strong)]">
                  工作区
                </span>
              </Button>
              <!-- 悬浮快捷操作：新建工作区 -->
              <Button variant="ghost" size="icon-sm"
                class="size-5 text-[var(--color-dim)] opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)] focus-visible:opacity-100 group-hover/zone:opacity-100 dark:hover:text-[var(--color-txt-strong)]"
                aria-label="新建工作区" title="新建工作区" @click.stop="workspaceStore.create()">
                <Plus class="size-3.5" aria-hidden="true" />
              </Button>
              <ChevronDown
                class="mr-1 size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
                :class="workspacesZoneOpen ? '' : '-rotate-90'" aria-hidden="true" />
            </div>
          </div>

          <!-- 目录列表：左侧竖线导轨 + 目录行（可折叠）+ 目录内会话 -->
          <div v-if="workspacesZoneOpen" class="ml-2 mt-0.5 flex flex-col gap-0.5  pl-1">
            <p v-if="!workspaceGroups.length" class="px-2 py-1 text-[12px] text-[var(--color-dim)]">
              暂无工作区，点击上方 + 绑定目录
            </p>
            <ProjectSessionGroup v-for="group in workspaceGroups" :key="group.id" :group="group"
              :sessions="sessionsOf(group)" :open="groupOpen(group.id)"
              :expanded="workspaceStore.expanded.has(group.id)" :active-session-id="sessionId"
              :show-in-folder-label="showInFolderLabel" @toggle="onGroupToggle(group.id)"
              @toggle-expand="workspaceStore.toggleExpanded(group.id)" @new-session="onNewSessionIn(group.id)"
              @open="openSession" @pin="onPinSession"
              @archive="(session, archived) => onArchiveSession(session, archived)"
              @remove="pendingSessionDelete = $event" @pin-workspace="workspaceStore.pin(group.id, !group.pinned)"
              @rename="beginRenameWorkspace(group)" @copy-path="onCopyWorkspacePath(group)"
              @show-in-folder="onShowWorkspaceInFolder(group)" @delete-workspace="pendingWorkspaceDelete = group" />
          </div>
        </section>
      </div>
    </div>

    <div class="flex-none border-t border-[var(--color-line-soft)] p-2">
      <UserBlock />
    </div>
  </aside>
  <ConfirmDialog :open="!!pendingSessionDelete" :title="`删除会话「${pendingSessionDelete?.title ?? ''}」？`"
    description="会话的消息与记录会被一并删除，操作不可撤销。" confirm-label="删除会话" cancel-label="保留"
    @update:open="pendingSessionDelete = null" @confirm="onDeleteSession" />

  <!-- 工作区右键：重命名（只改侧栏显示名，不动磁盘目录） -->
  <Dialog :open="!!renamingWorkspace" @update:open="(value: boolean) => { if (!value) renamingWorkspace = null; }">
    <DialogContent
      class="w-[min(380px,calc(100vw-48px))] gap-2 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
      :show-close-button="false">
      <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
        重命名工作区
      </DialogTitle>
      <DialogDescription class="text-[12px] text-[var(--color-mut)]">
        只改侧栏显示名，不影响磁盘目录。
      </DialogDescription>
      <Input v-model="renameDraft" aria-label="工作区名称" @keydown.enter="commitRenameWorkspace" />
      <DialogFooter class="mt-1 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" @click="renamingWorkspace = null">取消</Button>
        <Button size="sm" @click="commitRenameWorkspace">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 工作区右键：删除（落库级联，需要二次确认） -->
  <ConfirmDialog :open="!!pendingWorkspaceDelete" :title="`删除工作区「${pendingWorkspaceDelete?.name ?? ''}」？`"
    description="仅从 Zen 移除该目录（磁盘文件不受影响）；其下的会话与消息会一并删除，不可恢复。" confirm-label="删除工作区" cancel-label="保留"
    @update:open="pendingWorkspaceDelete = null" @confirm="onDeleteWorkspace" />

  <SkillsDialog v-model:open="skillsOpen" />
  <McpDialog v-model:open="mcpOpen" />
</template>