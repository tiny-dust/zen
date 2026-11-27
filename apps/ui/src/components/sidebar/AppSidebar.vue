<script setup lang="ts">
  import {
    IconArchive as Archive,
    IconChevronDown as ChevronDown,
    IconFolder as FolderClosed,
    IconLoader2 as LoaderCircle,
    IconPlus as Plus,
    IconPlugConnected as Server,
    IconSearch as Search,
    IconTrash as Trash2,
  } from "@tabler/icons-vue";
  import { storeToRefs } from "pinia";
  import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
  import { useI18n } from "vue-i18n";

  import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
  import ProjectSessionGroup from "@/components/sidebar/ProjectSessionGroup.vue";
  import SessionActionsMenu from "@/components/sidebar/SessionActionsMenu.vue";
  import SessionPeekCard from "@/components/sidebar/SessionPeekCard.vue";
  import ExportSessionDialog from "@/components/session/ExportSessionDialog.vue";
  import { sortGroupsByActivity, sortSessionsByActivity } from "@/lib/workspace-order";
  import { Button } from "@/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
  } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { toast } from "@/components/ui/toast";
  import { useChatStore } from "@/stores/chat";
  import { useAgentServicesStore } from "@/stores/agent-services";
  import { useSessionStatusStore } from "@/stores/session-status";
  import { useTerminalStore } from "@/stores/terminal";
  import { useWorkbenchPageStore } from "@/stores/workbench-page";
  import { useWorkspaceStore } from "@/stores/workspace";

  import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

  /**
   * 会话面板（圆角工作区里的一列）：搜索 + 公共区 + 工作区分组。
   * 分类入口在左侧 52px 轨道（AppRail），账户入口在轨道底部，这里只管会话。
   */
  const workspaceStore = useWorkspaceStore();
  const chatStore = useChatStore();
  const terminalStore = useTerminalStore();
  const pageStore = useWorkbenchPageStore();
  const agentServices = useAgentServicesStore();
  const { activeSessionCounts } = storeToRefs(agentServices);
  const { sessionId } = storeToRefs(chatStore);
  const { groups } = storeToRefs(workspaceStore);

  const { t } = useI18n();

  const pendingSessionDelete = ref<SessionRecord | null>(null);
  /** 导出目标会话：侧栏任意会话都可直接导出，不用先切换过去 */
  const exportTarget = ref<SessionRecord | null>(null);
  /** 批量删除确认：所选会话一次性确认后逐个删除 */
  const pendingBatchDelete = ref<SessionRecord[] | null>(null);
  /** 工作区右键：重命名弹窗与删除确认 */
  const renamingWorkspace = ref<WorkspaceGroup | null>(null);
  const renameDraft = ref("");
  const pendingWorkspaceDelete = ref<WorkspaceGroup | null>(null);
  /** 「在文件管理器中显示」按平台文案（Windows 资源管理器 / Linux 文件管理器） */
  const showInFolderLabel = ref(t("sidebar.showInFinder"));

  onMounted(async () => {
    agentServices.bindEvents();
    terminalStore.bindEvents();
    const info = window.zen ? await window.zen.shell.platformInfo() : null;
    if (info?.showInFolderLabel) {
      showInFolderLabel.value = info.showInFolderLabel;
    }
  });

  /** 公共区：顶级分组（组头即区块头） */
  const commonGroup = computed(() =>
    groups.value.find((item) => item.id === "common" && !item.archived) ?? null,
  );

  /** 项目工作区列表：置顶优先，其余按最近活动排序（刚有对话的目录浮到顶部） */
  const workspaceGroups = computed(() =>
    sortGroupsByActivity(groups.value.filter((item) => !item.archived && item.kind === "workspace")),
  );

  function sessionsOf(group: WorkspaceGroup): SessionRecord[] {
    return sortSessionsByActivity(group.sessions.filter((item) => !item.archived));
  }

  /** 会话搜索：防抖 200ms 查询；有词时会话区切换为结果列表（搜索结果行 = 标题 + 所属组名小字） */
  const searchQuery = ref("");
  const searchResults = ref<SessionRecord[]>([]);
  /** 搜索响应序号：快速连续输入时丢弃过期响应 */
  let searchSeq = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** 一次查询的结果条数上限（侧栏场景够用，避免大库全量返回） */
  const SEARCH_LIMIT = 30;

  const searchActive = computed(() => searchQuery.value.trim().length > 0);

  watch(searchQuery, (value) => {
    clearTimeout(searchTimer);
    const trimmed = value.trim();
    if (!trimmed) {
      // 空串/纯空格：立即恢复原列表，不发查询
      searchSeq += 1;
      searchResults.value = [];
      return;
    }
    searchTimer = setTimeout(() => void runSearch(trimmed), 200);
  });

  async function runSearch(query: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    const seq = ++searchSeq;
    const results = await zen.session.search(query, SEARCH_LIMIT);
    if (seq !== searchSeq) {
      return;
    }
    searchResults.value = results;
  }

  /** Esc：清空关键词并还原输入框，交还焦点给应用主体（不留在侧栏搜索框） */
  function onSearchEsc(event: KeyboardEvent) {
    searchQuery.value = "";
    (event.target as HTMLInputElement).blur();
  }

  /** 搜索结果行的所属组名：公共区用分组内置名；查不到（已删工作区等）留空 */
  function groupNameOf(session: SessionRecord): string {
    const id = session.workspaceId ?? "common";
    return groups.value.find((group) => group.id === id)?.name ?? "";
  }

  onBeforeUnmount(() => {
    clearTimeout(searchTimer);
    searchSeq += 1;
  });

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
    // 切会话即回到对话页（与 nomi 一致：选会话离开整页）
    pageStore.close();
    await chatStore.loadSession(record);
  }

  async function onNewSessionIn(workspaceId: string) {
    workspaceStore.setActive(workspaceId);
    if (workspaceStore.isCollapsed(workspaceId)) {
      workspaceStore.toggleCollapsed(workspaceId);
    }
    pageStore.close();
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

  // ---------- 会话操作菜单 + 悬停详情卡（对齐 nomi：右键与「更多」共用一个菜单） ----------
  const sessionMenu = ref<{ session: SessionRecord; x: number; y: number } | null>(null);
  /** 详情卡：hoverDelay 后才弹出，鼠标移进卡片不收起，方便点标题改名 */
  const peek = ref<{ session: SessionRecord; top: number; left: number; editing: boolean } | null>(null);
  const PEEK_SHOW_DELAY = 400;
  const PEEK_HIDE_DELAY = 180;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;

  function clearPeekTimer() {
    clearTimeout(peekTimer);
    peekTimer = undefined;
  }

  /** 行悬停 / 键盘聚焦：弹出详情卡；el 为 null 时稍等再收（鼠标要能移进卡片） */
  function onPeekSession(session: SessionRecord, el: HTMLElement | null) {
    clearPeekTimer();
    if (!el) {
      peekTimer = setTimeout(() => {
        peek.value = null;
      }, PEEK_HIDE_DELAY);
      return;
    }
    peekTimer = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      peek.value = {
        session,
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
        editing: peek.value?.session.id === session.id ? peek.value.editing : false,
      };
    }, peek.value?.session.id === session.id ? 0 : PEEK_SHOW_DELAY);
  }

  /** 卡片里的鼠标：保持显示 */
  function holdPeek() {
    clearPeekTimer();
  }

  function openSessionMenu(session: SessionRecord, x: number, y: number) {
    peek.value = null;
    clearPeekTimer();
    sessionMenu.value = { session, x, y };
  }

  /** 「更多」按钮：菜单贴在按钮右下角 */
  function openSessionMenuAt(session: SessionRecord, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    openSessionMenu(session, rect.right - 200, rect.bottom + 2);
  }

  /** 菜单动作统一先取走目标会话再收起菜单：菜单先 emit close，晚读 sessionMenu 会拿到 null */
  function takeMenuSession(): SessionRecord | null {
    const target = sessionMenu.value?.session ?? null;
    sessionMenu.value = null;
    return target;
  }

  function menuPin() {
    const target = takeMenuSession();
    if (target) void onPinSession(target);
  }

  function menuFork() {
    const target = takeMenuSession();
    if (target) void onForkSession(target);
  }

  function menuExport() {
    exportTarget.value = takeMenuSession();
  }

  function menuArchive(archived: boolean) {
    const target = takeMenuSession();
    if (target) void onArchiveSession(target, archived);
  }

  function menuRemove() {
    const target = takeMenuSession();
    if (target) pendingSessionDelete.value = target;
  }

  function onMenuRename() {
    const target = sessionMenu.value?.session;
    sessionMenu.value = null;
    if (!target) return;
    const row = document.querySelector<HTMLElement>(`[data-session-id="${target.id}"]`);
    const rect = row?.getBoundingClientRect();
    peek.value = {
      session: target,
      top: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
      left: rect ? rect.right + 8 : 320,
      editing: true,
    };
  }

  /** 会话改名：菜单 / 详情卡共用一个入口，当前会话同步页头标题 */
  async function onRenameSession(session: SessionRecord, title: string) {
    const next = title.trim();
    if (!next || next === session.title) return;
    await window.zen?.session.rename(session.id, next);
    workspaceStore.renameSessionLocal(session.id, next);
    if (chatStore.sessionId === session.id) chatStore.sessionName = next;
    if (peek.value?.session.id === session.id) peek.value.session.title = next;
  }

  /**
   * 从会话分叉：Zen 的分叉按「消息」发起，这里取最后一条消息作为边界（= 整段复制）。
   * 运行中的会话主进程会拒绝，空会话没有可复制的边界，都直接给出提示。
   */
  async function onForkSession(session: SessionRecord) {
    const zen = window.zen;
    if (!zen) return;
    if (statusById.value[session.id] === "running") {
      toast.err(t("sidebar.forkRunning"));
      return;
    }
    const snapshot = await zen.session.snapshot(session.id);
    const messages = snapshot?.messages ?? [];
    const anchor = messages[messages.length - 1];
    if (!anchor) {
      toast.err(t("sidebar.forkEmpty"));
      return;
    }
    const result = await zen.session.fork(session.id, anchor.id);
    if (!result.ok || !result.sessionId) {
      toast.err(result.error || t("sidebar.forkFailed"));
      return;
    }
    await workspaceStore.refresh();
    const created = groups.value.flatMap((group) => group.sessions).find((item) => item.id === result.sessionId);
    if (created) await openSession(created);
  }

  /** 详情卡的状态行：运行中 / 待确认 / 上次结果，与行首状态点同源 */
  function peekStatusOf(session: SessionRecord): string {
    const runtime = statusById.value[session.id];
    if (runtime === "running") return t("sidebar.running");
    if (runtime === "needs_action") return t("sidebar.pendingConfirm");
    if (sessionStatus.hasUnseenResult(session.id)) {
      return runtime === "error" ? t("sidebar.lastRunFailed") : t("sidebar.lastRunDone");
    }
    return "";
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
    try {
      await window.zen?.session.remove(session.id);
    } catch (error) {
      toast.err(error instanceof Error ? error.message : String(error));
      return;
    }
    if (sessionId.value === session.id) await chatStore.newTask(undefined, false);
    workspaceStore.removeSessionLocal(session.id);
  }

  /** 批量操作（批量管理模式的置顶/归档/删除）：逐会话执行同一动作，本地列表同步更新 */
  async function onBatchSessions(action: "pin" | "unpin" | "archive" | "delete", sessions: SessionRecord[]) {
    const zen = window.zen;
    if (!zen || !sessions.length) {
      return;
    }
    if (action === "delete") {
      // 删除是落库级联操作：先弹一次批量确认
      pendingBatchDelete.value = sessions;
      return;
    }
    for (const session of sessions) {
      if (action === "archive") {
        await zen.session.archive(session.id, true);
        workspaceStore.archiveSessionLocal(session.id, true);
      } else {
        const pinned = action === "pin";
        await zen.session.pin(session.id, pinned);
        workspaceStore.pinSessionLocal(session.id, pinned);
      }
    }
  }

  async function onBatchDeleteConfirm() {
    const sessions = pendingBatchDelete.value;
    pendingBatchDelete.value = null;
    const zen = window.zen;
    if (!zen || !sessions?.length) {
      return;
    }
    for (const session of sessions) {
      try {
        await zen.session.remove(session.id);
      } catch (error) {
        toast.err(error instanceof Error ? error.message : String(error));
        return;
      }
      if (sessionId.value === session.id) await chatStore.newTask(undefined, false);
      workspaceStore.removeSessionLocal(session.id);
    }
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
    try {
      await workspaceStore.remove(group.id);
    } catch (error) {
      toast.err(error instanceof Error ? error.message : String(error));
    }
  }

  // ---------- 已归档：归档会话与归档工作区都可在这里找回 ----------
  const ARCHIVED_ZONE_KEY = "zone:archived";
  const archivedZoneOpen = computed(() => !workspaceStore.isCollapsed(ARCHIVED_ZONE_KEY));
  const archivedSessions = computed(() =>
    groups.value
      .flatMap((group) =>
        group.sessions
          .filter((session) => session.archived)
          .map((session) => ({ session, groupName: group.name })),
      )
      .sort((a, b) => b.session.updatedAt - a.session.updatedAt),
  );
  const archivedWorkspaces = computed(() => groups.value.filter((group) => group.archived));
  const archivedCount = computed(() => archivedSessions.value.length + archivedWorkspaces.value.length);

  function toggleArchivedZone() {
    workspaceStore.toggleCollapsed(ARCHIVED_ZONE_KEY);
  }

  function restoreSession(session: SessionRecord) {
    void onArchiveSession(session, false);
  }

  async function restoreWorkspace(group: WorkspaceGroup) {
    await workspaceStore.archive(group.id, false);
  }

  /** 「工作区」区块折叠键：复用工作区分组的同一持久化集合（localStorage） */
  const WORKSPACES_ZONE_KEY = "zone:workspaces";
  /** 工作区区块是否展开（折叠后只显示区块头，隐藏全部目录与目录内会话） */
  const workspacesZoneOpen = computed(() => !workspaceStore.isCollapsed(WORKSPACES_ZONE_KEY));

  /** 区块折叠时全部工作区里仍在运行的会话数：组头补 spinner，折叠后也能看到有任务在跑 */
  const sessionStatus = useSessionStatusStore();
  const { byId: statusById } = storeToRefs(sessionStatus);
  const zoneRunningCount = computed(() => {
    if (workspacesZoneOpen.value) {
      return 0;
    }
    let count = 0;
    for (const group of workspaceGroups.value) {
      for (const session of group.sessions) {
        if (!session.archived && statusById.value[session.id] === "running") {
          count += 1;
        }
      }
    }
    return count;
  });

  const zoneTerminalCount = computed(() => {
    if (workspacesZoneOpen.value) return 0;
    return workspaceGroups.value.reduce(
      (total, group) => total + group.sessions.reduce(
        (sum, session) => sum + (session.archived ? 0 : activeSessionCounts.value[session.id] ?? 0),
        0,
      ),
      0,
    );
  });

  function toggleWorkspacesZone() {
    workspaceStore.toggleCollapsed(WORKSPACES_ZONE_KEY);
  }
</script>

<template>
  <aside class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" :aria-label="t('sidebar.sidebar')">
    <div class="flex h-11 flex-none items-center px-2">
      <div class="relative min-w-0 flex-1">
        <Search
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--color-mut)]"
          aria-hidden="true" />
        <Input v-model="searchQuery" class="h-8 pl-8 text-[13px]" :aria-label="t('sidebar.searchSessions')"
          :placeholder="t('sidebar.searchSessions')" @keydown.esc="onSearchEsc" />
      </div>
    </div>

    <!-- 会话分区：公共区 / 工作区（单层滚动容器，区块头可折叠）；有搜索词时整块切换为搜索结果 -->
    <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-0 pt-1 pb-2">
      <!-- 搜索结果：平铺列表（标题 + 所属组名小字），点击直接打开该会话 -->
      <template v-if="searchActive">
        <p v-if="!searchResults.length" class="px-2.5 pt-1 text-[12px] text-[var(--color-dim)]">
          {{ t("sidebar.searchNoResults") }}
        </p>
        <ul v-else class="flex flex-col gap-0.5 px-2" :aria-label="t('sidebar.searchResults')">
          <li v-for="session in searchResults" :key="session.id">
            <button type="button"
              class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)] focus-visible:bg-[var(--color-side-hover)]"
              :class="session.id === sessionId
                ? 'bg-[var(--color-side-sel)] font-medium text-[var(--color-txt-strong)]'
                : 'text-[var(--color-side-item)]'"
              :aria-current="session.id === sessionId ? 'true' : undefined"
              @click="openSession(session)">
              <span class="min-w-0 flex-1 truncate">{{ session.title }}</span>
              <span v-if="activeSessionCounts[session.id]"
                :title="t('sidebar.activeTerminalServices', { n: activeSessionCounts[session.id] })"
                :aria-label="t('sidebar.activeTerminalServices', { n: activeSessionCounts[session.id] })" role="status"
                class="flex flex-none items-center gap-0.5 text-[var(--color-ok)]">
                <Server class="size-3" aria-hidden="true" />
                <span v-if="activeSessionCounts[session.id] > 1" class="text-[10px]">{{ activeSessionCounts[session.id] }}</span>
              </span>
              <span class="max-w-[45%] min-w-0 flex-none truncate text-[12px] text-[var(--color-dim)]">
                {{ groupNameOf(session) }}
              </span>
            </button>
          </li>
        </ul>
      </template>

      <template v-else>
        <!-- 公共区：组头即区块头（variant=zone），点击折叠/展开其下会话 -->
        <ProjectSessionGroup v-if="commonGroup" variant="zone" :group="commonGroup" :sessions="sessionsOf(commonGroup)"
          :open="groupOpen(commonGroup.id)" :expanded="workspaceStore.expanded.has(commonGroup.id)"
          :active-session-id="sessionId" :show-in-folder-label="showInFolderLabel"
          @toggle="onGroupToggle(commonGroup.id)" @toggle-expand="workspaceStore.toggleExpanded(commonGroup.id)"
          @new-session="onNewSessionIn(commonGroup.id)" @open="openSession" @pin="onPinSession"
          @batch="onBatchSessions"
          @more="openSessionMenuAt" @menu="openSessionMenu" @peek="onPeekSession" />

        <div class="mx-2.5 h-px flex-none bg-[var(--color-line-soft)]" aria-hidden="true" />

        <!-- 工作区：区块头（可折叠）+ 各项目目录（几何与公共区区块头对齐：h-8 / hover 面同缩进） -->
        <section class="flex flex-col">
          <div class="px-2">
            <div
              class="group/zone flex h-8 items-center gap-2 rounded-sm pr-1 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)]">
              <Button variant="ghost"
                class="h-full flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                :aria-expanded="workspacesZoneOpen" :aria-label="t('sidebar.workspaces')" @click="toggleWorkspacesZone">
                <span class="flex size-5 flex-none items-center justify-center rounded-md bg-[var(--color-side-hover)]"
                  aria-hidden="true">
                  <FolderClosed class="size-4 text-[var(--color-mut)]" />
                </span>
                <span class="min-w-0 flex-1 truncate font-semibold text-[var(--color-txt-strong)]">
                  {{ t("sidebar.workspaces") }}
                </span>
              </Button>
              <!-- 折叠态运行汇总：区块折叠时组内仍有会话在跑 -->
              <span v-if="zoneRunningCount"
                class="flex flex-none items-center gap-1 rounded-full bg-[var(--color-side-chip)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-accent)]"
                :title="t('sidebar.collapsedRunning', { n: zoneRunningCount })"
                :aria-label="t('sidebar.collapsedRunning', { n: zoneRunningCount })" role="status">
                <LoaderCircle class="size-3 shrink-0 animate-spin" aria-hidden="true" />
                <span v-if="zoneRunningCount > 1" class="font-[family-name:var(--font-mono)]">{{ zoneRunningCount }}</span>
              </span>
              <span v-if="zoneTerminalCount"
                class="flex flex-none items-center gap-1 rounded-full bg-[var(--color-side-chip)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-ok)]"
                :title="t('sidebar.collapsedTerminalServices', { n: zoneTerminalCount })"
                :aria-label="t('sidebar.collapsedTerminalServices', { n: zoneTerminalCount })" role="status">
                <Server class="size-3 shrink-0" aria-hidden="true" />
                <span v-if="zoneTerminalCount > 1" class="font-[family-name:var(--font-mono)]">{{ zoneTerminalCount }}</span>
              </span>
              <!-- 悬浮快捷操作：新建工作区 -->
              <Button variant="ghost" size="icon-sm"
                class="size-5 text-[var(--color-dim)] opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)] focus-visible:opacity-100 group-hover/zone:opacity-100 dark:hover:text-[var(--color-txt-strong)]"
                :aria-label="t('sidebar.newWorkspace')" :title="t('sidebar.newWorkspace')" @click.stop="workspaceStore.create()">
                <Plus class="size-3.5" aria-hidden="true" />
              </Button>
              <ChevronDown
                class="mr-1 size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
                :class="workspacesZoneOpen ? '' : '-rotate-90'" aria-hidden="true" />
            </div>
          </div>

          <!-- 目录列表：左侧竖线导轨 + 目录行（可折叠）+ 目录内会话 -->
          <div v-if="workspacesZoneOpen" class="mt-0.5 ml-2 flex flex-col gap-0.5 pl-1">
            <p v-if="!workspaceGroups.length" class="px-2 py-1 text-[12px] text-[var(--color-dim)]">
              {{ t("sidebar.noWorkspaces") }}
            </p>
            <ProjectSessionGroup v-for="group in workspaceGroups" :key="group.id" :group="group"
              :sessions="sessionsOf(group)" :open="groupOpen(group.id)"
              :expanded="workspaceStore.expanded.has(group.id)" :active-session-id="sessionId"
              :show-in-folder-label="showInFolderLabel" @toggle="onGroupToggle(group.id)"
              @toggle-expand="workspaceStore.toggleExpanded(group.id)" @new-session="onNewSessionIn(group.id)"
              @open="openSession" @pin="onPinSession"
              @batch="onBatchSessions"
              @more="openSessionMenuAt" @menu="openSessionMenu" @peek="onPeekSession"
              @pin-workspace="workspaceStore.pin(group.id, !group.pinned)"
              @rename="beginRenameWorkspace(group)" @copy-path="onCopyWorkspacePath(group)"
              @show-in-folder="onShowWorkspaceInFolder(group)" @delete-workspace="pendingWorkspaceDelete = group" />
          </div>
        </section>

        <!-- 已归档：归档会话与归档工作区都在这里找回（隐藏不等于删除） -->
        <div class="mx-2.5 h-px flex-none bg-[var(--color-line-soft)]" aria-hidden="true" />

        <section class="flex flex-col">
          <div class="px-2">
            <div
              class="group/zone flex h-8 items-center gap-2 rounded-sm pr-1 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)]">
              <Button variant="ghost"
                class="h-full flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                :aria-expanded="archivedZoneOpen" :aria-label="t('sidebar.archivedZone')" @click="toggleArchivedZone">
                <span class="flex size-5 flex-none items-center justify-center rounded-md bg-[var(--color-side-hover)]"
                  aria-hidden="true">
                  <Archive class="size-4 text-[var(--color-mut)]" />
                </span>
                <span class="min-w-0 flex-1 truncate font-semibold text-[var(--color-txt-strong)]">
                  {{ t("sidebar.archivedZone") }}
                </span>
                <span v-if="archivedCount" class="text-[11px] font-normal text-[var(--color-dim)]">{{ archivedCount }}</span>
              </Button>
              <ChevronDown class="mr-1 size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
                :class="archivedZoneOpen ? '' : '-rotate-90'" aria-hidden="true" />
            </div>
          </div>

          <div v-if="archivedZoneOpen" class="mt-0.5 ml-2 flex flex-col gap-0.5 pl-1">
            <p v-if="!archivedCount" class="px-2 py-1 text-[12px] text-[var(--color-dim)]">
              {{ t("sidebar.archivedEmpty") }}
            </p>

            <div v-for="entry in archivedSessions" :key="entry.session.id"
              class="group/archived flex h-8 items-center gap-2 rounded-sm pr-1 pl-2 text-[13px] text-[var(--color-side-item)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)]">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left"
                :title="entry.groupName" @click="openSession(entry.session)">
                <span class="min-w-0 flex-1 truncate">{{ entry.session.title }}</span>
                <span class="max-w-[45%] min-w-0 flex-none truncate text-[11px] text-[var(--color-dim)]">{{ entry.groupName }}</span>
              </button>
              <Button variant="ghost" size="xs"
                class="h-6 flex-none px-1.5 text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
                :aria-label="t('sidebar.restore')" :title="t('sidebar.restore')" @click.stop="restoreSession(entry.session)">
                {{ t("sidebar.restore") }}
              </Button>
              <button type="button"
                class="flex size-5 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-mut)] opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-del)] focus-visible:opacity-100 group-hover/archived:opacity-100"
                :aria-label="t('sidebar.deleteSession')" :title="t('sidebar.deleteSession')"
                @click.stop="pendingSessionDelete = entry.session">
                <Trash2 class="size-3.5 shrink-0" aria-hidden="true" />
              </button>
            </div>

            <div v-for="group in archivedWorkspaces" :key="group.id"
              class="group/archived flex h-8 items-center gap-2 rounded-sm pr-1 pl-2 text-[13px] text-[var(--color-side-item)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)]">
              <FolderClosed class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ group.name }}</span>
              <span class="flex-none text-[11px] text-[var(--color-dim)]">{{ t("sidebar.archivedTag") }}</span>
              <Button variant="ghost" size="xs"
                class="h-6 flex-none px-1.5 text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
                :aria-label="t('sidebar.restoreWorkspace')" :title="t('sidebar.restoreWorkspace')"
                @click.stop="restoreWorkspace(group)">
                {{ t("sidebar.restore") }}
              </Button>
            </div>
          </div>
        </section>
      </template>
    </div>
  </aside>

  <!-- 会话操作菜单（右键 / 「更多」共用）与悬停详情卡：挂在 body 上，不受侧栏裁切 -->
  <SessionActionsMenu
    v-if="sessionMenu"
    :session="sessionMenu.session"
    :x="sessionMenu.x"
    :y="sessionMenu.y"
    :can-fork="statusById[sessionMenu.session.id] !== 'running'"
    @close="sessionMenu = null"
    @rename="onMenuRename"
    @pin="menuPin"
    @fork="menuFork"
    @export="menuExport"
    @archive="menuArchive"
    @remove="menuRemove"
  />

  <SessionPeekCard
    v-if="peek"
    :session="peek.session"
    :top="peek.top"
    :left="peek.left"
    :status="peekStatusOf(peek.session)"
    :place="groupNameOf(peek.session)"
    :editing="peek.editing"
    @update:editing="(value: boolean) => { if (peek) peek.editing = value; }"
    @rename="(title: string) => peek && onRenameSession(peek.session, title)"
    @hold="holdPeek"
    @release="onPeekSession(peek!.session, null)"
  />

  <ConfirmDialog :open="!!pendingSessionDelete" :title="t('sidebar.deleteSessionTitle', { title: pendingSessionDelete?.title ?? '' })"
    :description="t('sidebar.deleteSessionDesc')" :confirm-label="t('sidebar.deleteSession')" :cancel-label="t('sidebar.keep')"
    @update:open="pendingSessionDelete = null" @confirm="onDeleteSession" />

  <!-- 工作区右键：重命名（只改侧栏显示名，不动磁盘目录） -->
  <Dialog :open="!!renamingWorkspace" @update:open="(value: boolean) => { if (!value) renamingWorkspace = null; }">
    <DialogContent
      class="w-[min(380px,calc(100vw-48px))] gap-2 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
      :show-close-button="false">
      <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
        {{ t("sidebar.renameWorkspace") }}
      </DialogTitle>
      <DialogDescription class="text-[12px] text-[var(--color-mut)]">
        {{ t("sidebar.renameWorkspaceDesc") }}
      </DialogDescription>
      <Input v-model="renameDraft" :aria-label="t('sidebar.workspaceNameLabel')" @keydown.enter="commitRenameWorkspace" />
      <DialogFooter class="mt-1 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" @click="renamingWorkspace = null">{{ t("common.cancel") }}</Button>
        <Button size="sm" @click="commitRenameWorkspace">{{ t("common.save") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 工作区右键：删除（落库级联，需要二次确认） -->
  <ConfirmDialog :open="!!pendingWorkspaceDelete" :title="t('sidebar.deleteWorkspaceTitle', { name: pendingWorkspaceDelete?.name ?? '' })"
    :description="t('sidebar.deleteWorkspaceDesc')" :confirm-label="t('sidebar.deleteWorkspace')" :cancel-label="t('sidebar.keep')"
    @update:open="pendingWorkspaceDelete = null" @confirm="onDeleteWorkspace" />

  <!-- 批量管理：删除确认（一次确认删除所选全部会话） -->
  <ConfirmDialog :open="!!pendingBatchDelete" :title="t('sidebar.batchDeleteTitle', { n: pendingBatchDelete?.length ?? 0 })"
    :description="t('sidebar.batchDeleteDesc')" :confirm-label="t('sidebar.batchDelete')" :cancel-label="t('sidebar.keep')"
    @update:open="pendingBatchDelete = null" @confirm="onBatchDeleteConfirm" />

  <ExportSessionDialog
    :open="!!exportTarget"
    :session-id="exportTarget?.id ?? ''"
    :session-title="exportTarget?.title"
    @update:open="(open: boolean) => { if (!open) exportTarget = null; }"
  />
</template>
