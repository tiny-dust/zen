<script setup lang="ts">
  import { ChevronDown, Copy, ExternalLink, Folder, Globe, ListChecks, LoaderCircle, Pencil, Pin, PinOff, Plus, Trash2 } from "@lucide/vue";
  import { storeToRefs } from "pinia";
  import { computed, ref } from "vue";
  import { useI18n } from "vue-i18n";

  import SessionRow from "@/components/sidebar/SessionRow.vue";
  import DangerIconButton from "@/components/base/DangerIconButton.vue";
  import { Button } from "@/components/ui/button";
  import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
  } from "@/components/ui/context-menu";
  import { useSessionStatusStore } from "@/stores/session-status";
  import { useWorkspaceStore } from "@/stores/workspace";

  import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

  const props = defineProps<{
    group: WorkspaceGroup;
    /** 已过滤并排序的全量会话 */
    sessions: SessionRecord[];
    /** 组折叠开关（false = 只显示组头行） */
    open: boolean;
    /** 展开显示全部会话（false = 截断 + 渐隐） */
    expanded: boolean;
    activeSessionId: string | null;
    /** 「在文件管理器中显示」按平台文案 */
    showInFolderLabel: string;
    /** 头部形态：zone = 区块头（图标盒 + 加粗标题，如公共区）；group = 工作区目录行（折叠箭头 + 目录名） */
    variant?: "zone" | "group";
  }>();

  const emit = defineEmits<{
    toggle: [];
    "toggle-expand": [];
    "new-session": [];
    open: [session: SessionRecord];
    pin: [session: SessionRecord];
    archive: [session: SessionRecord, archived: boolean];
    remove: [session: SessionRecord];
    "pin-workspace": [];
    rename: [];
    "copy-path": [];
    "show-in-folder": [];
    "delete-workspace": [];
    /** 批量操作：选中的会话交给父级执行（删除在父级弹确认） */
    batch: [action: "pin" | "unpin" | "archive" | "delete", sessions: SessionRecord[]];
  }>();

  const workspaceStore = useWorkspaceStore();

  const { t } = useI18n();

  const isCommon = computed(() => props.group.kind === "common");
  /** 区块头形态（公共区组头即区块头，视觉更重） */
  const isZone = computed(() => props.variant === "zone");
  const previewCount = workspaceStore.PREVIEW_COUNT;
  /** 未展开时多渲染 1 条露头，配合渐隐遮罩提示还有更多（批量模式下展示全量） */
  const shownSessions = computed(() =>
    batchMode.value || props.expanded ? props.sessions : props.sessions.slice(0, previewCount + 1),
  );
  const truncated = computed(
    () => !batchMode.value && !props.expanded && props.sessions.length > previewCount,
  );
  const showExpandToggle = computed(
    () => !batchMode.value && props.sessions.length > previewCount,
  );

  // ---------- 折叠态运行反馈 ----------
  /** 行内 spinner 在折叠时不可见：组头补一个汇总指示，避免「会话在跑却看不到」 */
  const sessionStatus = useSessionStatusStore();
  const { byId: statusById } = storeToRefs(sessionStatus);
  const runningCount = computed(() =>
    props.open
      ? 0
      : props.sessions.filter((item) => statusById.value[item.id] === "running").length,
  );

  // ---------- 批量管理模式（本组内多选 → 置顶 / 归档 / 删除） ----------
  /** 批量模式开关：进入后行首出勾选框、点击行切换勾选，不再打开会话 */
  const batchMode = ref(false);
  const selectedIds = ref(new Set<string>());

  const selectedSessions = computed(() =>
    props.sessions.filter((item) => selectedIds.value.has(item.id)),
  );
  const allSelected = computed(
    () => props.sessions.length > 0 && props.sessions.every((item) => selectedIds.value.has(item.id)),
  );
  /** 选中项已全部置顶时按钮翻转为「取消置顶」，否则置顶 */
  const pinAction = computed<"pin" | "unpin">(() =>
    selectedSessions.value.length > 0 &&
    selectedSessions.value.every((item) => item.pinned)
      ? "unpin"
      : "pin",
  );

  function enterBatch() {
    if (!props.sessions.length) {
      return;
    }
    selectedIds.value = new Set();
    batchMode.value = true;
  }

  function exitBatch() {
    batchMode.value = false;
    selectedIds.value = new Set();
  }

  function toggleSelect(session: SessionRecord) {
    const next = new Set(selectedIds.value);
    if (next.has(session.id)) {
      next.delete(session.id);
    } else {
      next.add(session.id);
    }
    selectedIds.value = next;
  }

  function toggleSelectAll() {
    selectedIds.value = allSelected.value
      ? new Set()
      : new Set(props.sessions.map((item) => item.id));
  }

  /** 执行批量动作后退出模式；删除的二次确认由父级（AppSidebar）负责 */
  function runBatch(action: "pin" | "unpin" | "archive" | "delete") {
    const selected = selectedSessions.value;
    if (!selected.length) {
      return;
    }
    exitBatch();
    emit("batch", action, selected);
  }
</script>

<template>
  <div class="px-2 pb-0.5">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          class="group/row flex h-8 items-center rounded-[var(--radius-sm)] pr-1 text-[var(--color-side-item)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]"
          :class="isZone ? 'gap-2' : ''">
          <Button variant="ghost"
            class="h-full flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-[12px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
            :class="isZone ? 'gap-2 px-1.5' : ''" :aria-expanded="open" :aria-label="group.name"
            @click="emit('toggle')">
            <!-- 区块头形态：图标盒 + 加粗标题（公共区组头即区块头） -->
            <template v-if="isZone">
              <span class="flex size-5 flex-none items-center justify-center rounded-md bg-[var(--color-side-hover)]"
                aria-hidden="true">
                <Globe class="size-4 text-[var(--color-mut)]" />
              </span>
              <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]">
                {{ group.name }}
              </span>
            </template>
            <!-- 分组形态：折叠箭头 + 目录名 -->
            <template v-else>
              <ChevronDown
                class="size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
                :class="open ? '' : '-rotate-90'" aria-hidden="true" />
              <Folder class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-[12px] font-medium">{{ group.name }}</span>
            </template>
          </Button>
          <!-- 折叠态运行汇总：组内会话在跑时组头补 spinner（展开时行内已有指示） -->
          <span
            v-if="runningCount"
            class="flex flex-none items-center gap-1 rounded-full bg-[var(--color-side-chip)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-accent)]"
            :title="t('sidebar.collapsedRunning', { n: runningCount })"
            :aria-label="t('sidebar.collapsedRunning', { n: runningCount })"
            role="status">
            <LoaderCircle class="size-3 shrink-0 animate-spin" aria-hidden="true" />
            <span v-if="runningCount > 1" class="font-[family-name:var(--font-mono)]">{{ runningCount }}</span>
          </span>
          <!-- 悬浮快捷操作：图标按钮 hover 只提亮图标不出底色，键盘聚焦时保持可见 -->
          <div
            class="flex flex-none items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] focus-within:opacity-100 group-hover/row:opacity-100">
            <Button variant="ghost" size="icon-sm"
              class="size-5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)] dark:hover:text-[var(--color-txt-strong)]"
              :aria-label="t('sidebar.newSession')" :title="t('sidebar.newSession')" @click.stop="emit('new-session')">
              <Plus class="size-3.5" aria-hidden="true" />
            </Button>
            <Button v-if="sessions.length" variant="ghost" size="icon-sm"
              class="size-5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)] dark:hover:text-[var(--color-txt-strong)]"
              :aria-label="t('sidebar.batchManage')" :title="t('sidebar.batchManage')" @click.stop="enterBatch()">
              <ListChecks class="size-3.5" aria-hidden="true" />
            </Button>
            <template v-if="!isCommon">
              <Button variant="ghost" size="icon-sm"
                class="size-5 text-[var(--color-del)] hover:text-[var(--color-danger-fg)] dark:hover:text-[var(--color-danger-fg)]"
                :aria-label="t('sidebar.deleteWorkspace')" :title="t('sidebar.deleteWorkspace')" @click.stop="emit('delete-workspace')">
                <Trash2 class="size-3.5" aria-hidden="true" />
              </Button>
            </template>
          </div>
          <!-- 行尾置顶开关：置顶时常显（accent 斜钉），可直接点击取消；未置顶时 hover 才浮现 -->
          <button v-if="!isCommon" type="button"
            class="flex size-5 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-dim)] transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)] focus-visible:opacity-100 group-hover/row:opacity-100"
            :class="group.pinned ? 'opacity-100' : 'opacity-0'"
            :aria-label="group.pinned ? t('sidebar.unpin') : t('sidebar.pin')" :title="group.pinned ? t('sidebar.unpin') : t('sidebar.pin')"
            @click.stop="emit('pin-workspace')">
            <Pin class="size-3.5" :class="group.pinned ? '-rotate-45 text-[var(--color-accent)]' : ''" aria-hidden="true" />
          </button>
          <!-- 区块头形态：尾部折叠箭头（可折叠的可见提示） -->
          <ChevronDown v-if="isZone"
            class="mr-1 size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="open ? '' : '-rotate-90'" aria-hidden="true" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="text-[12px]">
        <ContextMenuItem @select="emit('new-session')">
          <Plus class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
          {{ t("sidebar.newSession") }}
        </ContextMenuItem>
        <ContextMenuItem v-if="sessions.length" @select="enterBatch()">
          <ListChecks class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
          {{ t("sidebar.batchManage") }}
        </ContextMenuItem>
        <template v-if="!isCommon">
          <ContextMenuSeparator />
          <ContextMenuItem @select="emit('pin-workspace')">
            <PinOff v-if="group.pinned" class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            <Pin v-else class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ group.pinned ? t("sidebar.unpin") : t("sidebar.pin") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('rename')">
            <Pencil class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ t("sidebar.rename") }}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem @select="emit('copy-path')">
            <Copy class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ t("sidebar.copyPath") }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('show-in-folder')">
            <ExternalLink class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ showInFolderLabel }}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" @select="emit('delete-workspace')">
            <Trash2 class="size-3.5" aria-hidden="true" />
            {{ t("sidebar.deleteWorkspace") }}
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="open && sessions.length" class="mt-0.5">
      <!-- 批量管理操作条：计数 + 全选 + 置顶/归档/删除 + 退出 -->
      <div v-if="batchMode"
        class="mb-1 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-side-hover)] px-1.5 py-1"
        :class="isZone ? 'ml-3' : 'ml-5'" role="toolbar" :aria-label="t('sidebar.batchManage')">
        <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-mut)]">
          {{ selectedSessions.length ? t("sidebar.batchSelectedCount", { n: selectedSessions.length }) : t("sidebar.batchNoneSelected") }}
        </span>
        <Button variant="ghost" size="xs" class="h-6 flex-none px-1.5 text-[11px]" @click="toggleSelectAll">
          {{ allSelected ? t("sidebar.collapse") : t("sidebar.batchSelectAll") }}
        </Button>
        <Button variant="ghost" size="xs" class="h-6 flex-none px-1.5 text-[11px]" :disabled="!selectedSessions.length"
          @click="runBatch(pinAction)">
          {{ pinAction === "unpin" ? t("sidebar.batchUnpin") : t("sidebar.batchPin") }}
        </Button>
        <Button variant="ghost" size="xs" class="h-6 flex-none px-1.5 text-[11px]" :disabled="!selectedSessions.length"
          @click="runBatch('archive')">
          {{ t("sidebar.batchArchive") }}
        </Button>
        <DangerIconButton class="flex-none" :label="t('sidebar.batchDelete')" :disabled="!selectedSessions.length"
          @click="runBatch('delete')">
          <Trash2 class="size-[13px] shrink-0" />
        </DangerIconButton>
        <Button variant="ghost" size="xs" class="h-6 flex-none px-1.5 text-[11px]" @click="exitBatch">
          {{ t("sidebar.batchExit") }}
        </Button>
      </div>
      <div class="flex flex-col gap-0.5" :class="[isZone ? 'pl-3' : 'pl-5', truncated && 'session-list-fade']">
        <SessionRow v-for="session in shownSessions" :key="session.id" :session="session"
          :active="activeSessionId === session.id" :batch-mode="batchMode"
          :selected="selectedIds.has(session.id)" @open="emit('open', session)" @pin="emit('pin', session)"
          @archive="(archived) => emit('archive', session, archived)" @remove="emit('remove', session)"
          @toggle-select="toggleSelect(session)" />
      </div>
      <div v-if="showExpandToggle" class="flex justify-center pr-10 pt-0.5">
        <Button variant="ghost"
          class="h-7 px-2 text-[11px] font-normal text-[var(--color-dim)] hover:bg-transparent hover:text-[var(--color-mut)] dark:hover:bg-transparent"
          @click="emit('toggle-expand')">
          {{ expanded ? t("sidebar.collapse") : t("sidebar.showMore") }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>

  /* 截断态：5 行 + 第 6 行露头 12px，底部渐隐提示还有更多 */
  .session-list-fade {
    max-height: calc(32px * 5 + 2px * 5 + 12px);
    overflow: hidden;
    mask-image: linear-gradient(to bottom, var(--color-side) calc(100% - 26px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, var(--color-side) calc(100% - 26px), transparent);
  }
</style>