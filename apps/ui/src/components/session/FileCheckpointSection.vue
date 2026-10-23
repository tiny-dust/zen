<script setup lang="ts">
import { History, Redo2, RotateCcw, Trash2, Undo2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";

import type { FileCheckpoint, TurnCheckpointGroup } from "@zen/shared";

const { t } = useI18n();
const chatStore = useChatStore();
const open = ref(false);
const loading = ref(false);
const items = ref<FileCheckpoint[]>([]);
const turns = ref<TurnCheckpointGroup[]>([]);
const feedback = ref("");
/** 待二次确认的撤销目标轮（ConfirmDialog 打开中） */
const undoTarget = ref<TurnCheckpointGroup | null>(null);
const undoPending = ref(false);
const reapplyPending = ref(0);
/** 待二次确认的删除目标轮：只清快照记录与备份副本，不动工作区文件 */
const deleteTarget = ref<TurnCheckpointGroup | null>(null);
const deletePending = ref(false);

/** 展开时才拉取：快照随写文件持续增长，折叠态不值得轮询 */
async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await refresh();
  }
}

async function refresh(): Promise<void> {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  loading.value = true;
  try {
    [items.value, turns.value] = await Promise.all([
      zen.agent.listCheckpoints(chatStore.sessionId),
      zen.agent.listTurnCheckpoints(chatStore.sessionId),
    ]);
  } catch {
    items.value = [];
    turns.value = [];
  } finally {
    loading.value = false;
  }
}

/**
 * 可撤销轮（最新在前遍历）：只有最新的「未撤销」轮允许撤销，
 * 更早的未撤销轮会被旧副本覆盖新改动，置灰并提示先撤销更新的轮次。
 */
const undoableRun = computed<number | null>(() => {
  for (const group of turns.value) {
    if (!group.undone) {
      return group.run;
    }
  }
  return null;
});

/** 每轮的文件快照（列表最新在前；旧记录无 run 字段归入第 1 轮） */
function groupFiles(run: number): FileCheckpoint[] {
  return items.value.filter((item) => (item.run ?? 1) === run);
}

/** 操作成功后的公共收尾：刷新分组列表并递增 filesRevision 驱动文件面板重载 */
async function refreshAfterChange(): Promise<void> {
  chatStore.filesRevision += 1;
  await refresh();
}

async function confirmUndo(): Promise<void> {
  const zen = window.zen;
  const target = undoTarget.value;
  if (!zen || !target) {
    return;
  }
  undoPending.value = true;
  const result = await zen.agent.undoTurn(chatStore.sessionId, target.run);
  undoPending.value = false;
  if (!result.ok) {
    feedback.value = result.error || t("shell.checkpointRestoreFailed");
    undoTarget.value = null;
    return;
  }
  feedback.value = t("shell.turnUndoOk", { n: target.run, applied: result.applied ?? 0 }) +
    (result.skipped ? t("shell.turnSkippedSuffix", { n: result.skipped }) : "");
  undoTarget.value = null;
  await refreshAfterChange();
}

async function reapply(group: TurnCheckpointGroup): Promise<void> {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  reapplyPending.value = group.run;
  const result = await zen.agent.reapplyTurn(chatStore.sessionId, group.run);
  reapplyPending.value = 0;
  feedback.value = result.ok
    ? t("shell.turnReapplyOk", { n: group.run, applied: result.applied ?? 0 }) +
      (result.skipped ? t("shell.turnSkippedSuffix", { n: result.skipped }) : "")
    : (result.error || t("shell.checkpointRestoreFailed"));
  if (result.ok) {
    await refreshAfterChange();
  }
}

async function restore(checkpoint: FileCheckpoint): Promise<void> {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  const result = await zen.agent.restoreCheckpoint(chatStore.sessionId, checkpoint.id);
  feedback.value = result.ok
    ? t("shell.checkpointRestored", { path: checkpoint.relativePath })
    : (result.error || t("shell.checkpointRestoreFailed"));
  if (result.ok) {
    await refresh();
  }
}

/** 删除一轮快照：仅清磁盘上的备份副本与记录，工作区文件不受影响 */
async function confirmDelete(): Promise<void> {
  const zen = window.zen;
  const target = deleteTarget.value;
  if (!zen || !target) {
    return;
  }
  deletePending.value = true;
  const result = await zen.agent.deleteTurnCheckpoints(chatStore.sessionId, target.run);
  deletePending.value = false;
  deleteTarget.value = null;
  feedback.value = result.ok
    ? t("shell.turnDeleteOk", { n: target.run, count: result.removed ?? 0 })
    : (result.error || t("shell.checkpointRestoreFailed"));
  if (result.ok) {
    await refresh();
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="History"
      :title="t('shell.fileSnapshots')"
      :open="open"
      :count="items.length ? String(items.length) : undefined"
      :hint="t('shell.fileSnapshotsHelp')"
      @toggle="toggle"
    />
    <div v-if="open" class="mt-1 flex flex-col gap-2">
      <p v-if="loading" class="m-0 pl-[27px] text-[12px] text-[var(--color-dim)]">
        {{ t("shell.checkpointLoading") }}
      </p>
      <p v-else-if="!items.length" class="m-0 pl-[27px] text-[12px] text-[var(--color-dim)]">
        {{ t("shell.noSnapshots") }}
      </p>
      <div v-for="group in turns" :key="group.run" class="flex flex-col">
        <div class="flex min-h-8 items-center gap-2 px-[5px]">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-[13px] font-semibold text-[var(--color-txt)]">
              {{ t("shell.turnLabel", { n: group.run }) }}
            </span>
            <span class="text-[11px] text-[var(--color-mut)]">
              {{ formatTime(group.createdAt) }} ·
              {{ t("shell.turnFileCount", { n: group.fileCount }) }}
            </span>
          </div>
          <span
            v-if="group.undone"
            class="inline-flex h-5 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] text-[var(--color-mut)]"
          >
            {{ t("shell.turnUndoneBadge") }}
          </span>
          <Button
            variant="ghost"
            class="h-auto flex-none px-1 py-0.5 font-normal dark:hover:bg-[var(--color-menu-hover)]"
            :disabled="undoableRun !== group.run || undoPending"
            :aria-label="t('shell.turnUndo', { n: group.run })"
            :title="
              undoableRun === group.run
                ? t('shell.turnUndo', { n: group.run })
                : t('shell.turnUndoBlocked')
            "
            @click="undoTarget = group"
          >
            <Undo2 class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            class="h-auto flex-none px-1 py-0.5 font-normal dark:hover:bg-[var(--color-menu-hover)]"
            :disabled="!group.undone || reapplyPending === group.run"
            :aria-label="t('shell.turnReapply', { n: group.run })"
            :title="t('shell.turnReapply', { n: group.run })"
            @click="reapply(group)"
          >
            <Redo2 class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            class="h-auto flex-none px-1 py-0.5 font-normal dark:hover:bg-[var(--color-menu-hover)]"
            :disabled="deletePending"
            :aria-label="t('shell.turnDelete', { n: group.run })"
            :title="t('shell.turnDelete', { n: group.run })"
            @click="deleteTarget = group"
          >
            <Trash2 class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
        </div>
        <ul class="m-0 flex list-none flex-col p-0">
          <li
            v-for="item in groupFiles(group.run)"
            :key="item.id"
            class="flex min-h-8 items-center gap-2 px-[5px] text-[13px] text-[var(--color-txt)]"
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <span
                class="truncate font-[family-name:var(--font-mono)] text-[12px]"
                :title="item.relativePath"
              >
                {{ item.relativePath }}
              </span>
              <span class="text-[11px] text-[var(--color-mut)]">
                {{ formatTime(item.createdAt) }}
              </span>
            </div>
            <Button
              v-if="item.backupFile"
              variant="ghost"
              class="h-auto px-1 py-0.5 font-normal dark:hover:bg-[var(--color-menu-hover)]"
              :aria-label="t('shell.checkpointRestore', { path: item.relativePath })"
              :title="t('shell.checkpointRestore', { path: item.relativePath })"
              @click="restore(item)"
            >
              <RotateCcw class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
            </Button>
          </li>
        </ul>
      </div>
      <p
        v-if="feedback"
        class="m-0 pl-[27px] text-[11px] text-[var(--color-mut)]"
        role="status"
      >
        {{ feedback }}
      </p>
    </div>

    <ConfirmDialog
      :open="!!undoTarget"
      :title="undoTarget ? t('shell.turnUndoConfirmTitle', { n: undoTarget.run }) : ''"
      :description="
        undoTarget ? t('shell.turnUndoConfirmDesc', { n: undoTarget.fileCount }) : ''
      "
      :confirm-label="t('shell.turnUndoConfirm')"
      :pending="undoPending"
      @update:open="(next) => !next && (undoTarget = null)"
      @confirm="confirmUndo"
    />

    <ConfirmDialog
      :open="!!deleteTarget"
      :title="deleteTarget ? t('shell.turnDeleteConfirmTitle', { n: deleteTarget.run }) : ''"
      :description="
        deleteTarget ? t('shell.turnDeleteConfirmDesc', { count: deleteTarget.fileCount }) : ''
      "
      :confirm-label="t('shell.turnDelete', { n: deleteTarget?.run ?? 0 })"
      :pending="deletePending"
      @update:open="(next) => !next && (deleteTarget = null)"
      @confirm="confirmDelete"
    />
  </section>
</template>
