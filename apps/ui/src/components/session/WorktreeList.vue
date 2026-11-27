<script setup lang="ts">
import {
  IconChevronDown as ChevronDown,
  IconExternalLink as ExternalLink,
  IconFolder as FolderOpen,
  IconGitBranch as GitBranch,
  IconRefresh as RefreshCw,
  IconTrash as Trash2,
} from "@tabler/icons-vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useSessionWorktreeStore } from "@/stores/session-worktree";

import type { RepoWorktree } from "@zen/shared";

/**
 * 仓库级工作树清单：展示 `git worktree list` 登记的全部工作树
 * （含 Agent / 其他工具创建的链接工作树），只做「看到 + 打开 + 安全移除」。
 *
 * 与 SessionWorktreeSection 的分工：那条会话工作树的生命周期（创建/移除）
 * 由会话节负责，这里只读展示它的状态徽标，不提供 Zen 语义的移除入口。
 * 仓库级的变更/提交/同步仍由下方的 RepoPanel 承担，本组件不重复一套 UI。
 */
const props = defineProps<{
  repoPath: string;
  repoName: string;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

/** 默认收起；首次展开才请求，避免每个仓库都无条件跑一次 git */
const open = ref(false);
const loaded = ref(false);
const loading = ref(false);
const worktrees = ref<RepoWorktree[]>([]);
/** 读取/删除失败的同一个展示位（列表上方 role="alert"） */
const error = ref("");
const removeTarget = ref<RepoWorktree | null>(null);
const removing = ref(false);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function refresh() {
  const zen = window.zen;
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    if (!zen?.git?.worktrees) {
      worktrees.value = [];
      error.value = t("worktree.listError");
      loaded.value = true;
      return;
    }
    // 把会话当前执行目录一起交给主进程，由它标 current（外部工作树同样适用）
    const currentPath = useSessionWorktreeStore().current(useChatStore().sessionId)?.path;
    const result = await zen.git.worktrees(props.repoPath, currentPath);
    const target = normalizePath(props.repoPath);
    // 单仓库请求正常只回一条；路径比较容忍尾斜杠/分隔符差异
    const entry =
      result.repos.find((repo) => normalizePath(repo.repoPath) === target) ??
      (result.repos.length === 1 ? result.repos[0] : undefined);
    worktrees.value = entry?.worktrees ?? [];
    error.value = result.error ?? "";
    loaded.value = true;
  } catch (reason) {
    worktrees.value = [];
    error.value = reason instanceof Error ? reason.message : String(reason);
    loaded.value = true;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.repoPath,
  () => {
    worktrees.value = [];
    loaded.value = false;
    error.value = "";
    removeTarget.value = null;
    if (open.value) void refresh();
  },
);

watch(open, (value) => {
  if (value && !loaded.value) void refresh();
});

function toggle() {
  open.value = !open.value;
}

/** 收起时点刷新等于展开并加载（request 由 open 的 watcher 触发），不做一个点了没反应的空按钮 */
function refreshFromHeader() {
  if (!open.value) {
    open.value = true;
    return;
  }
  void refresh();
}

const headerHint = computed(() => t("worktree.listHint", { repo: props.repoName }));

/** 徽标：主工作树 / Zen 管理 / 当前执行目录 / 已锁定 / 目录丢失 */
const badgeCls =
  "flex-none whitespace-nowrap rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] leading-4 text-[var(--color-mut)]";

function openPanelTitle(wt: RepoWorktree): string {
  if (wt.operable) return t("worktree.openPanelTitle");
  const reason = wt.blockedReason ?? t("worktree.notOperable");
  return t("worktree.openPanelBlocked", { reason });
}

async function revealInFolder(wt: RepoWorktree) {
  if (wt.missing) return;
  const result = await window.zen?.shell?.showInFolder(wt.path);
  if (result && !result.ok) {
    error.value = result.error ?? t("worktree.revealFailed");
  }
}

async function openInPanel(wt: RepoWorktree) {
  if (!wt.operable) return;
  await gitStore.selectRepository(wt.path);
  gitStore.openGitPanel();
}

function startRemove(wt: RepoWorktree) {
  if (wt.blockedReason) return;
  error.value = "";
  removeTarget.value = wt;
}

const removeDescription = computed(() => {
  const target = removeTarget.value;
  if (!target) return "";
  return t("worktree.removeTarget", { path: target.path, branch: target.branch });
});

async function confirmRemove() {
  const target = removeTarget.value;
  const zen = window.zen;
  if (!target) return;
  if (!zen?.git?.removeWorktree) {
    removeTarget.value = null;
    error.value = t("worktree.removeFailed");
    return;
  }
  removing.value = true;
  try {
    const result = await zen.git.removeWorktree(props.repoPath, target.path);
    removeTarget.value = null;
    if (!result.ok) {
      // 失败保留列表项：错误原因来自主进程（脏目录、锁定、被占用等）
      error.value = result.error ?? t("worktree.removeFailed");
      toast.err(error.value);
      return;
    }
    toast.ok(
      result.pruned
        ? t("worktree.removedPruned", { branch: target.branch })
        : t("worktree.removed", { branch: target.branch }),
    );
    await refresh();
  } catch (reason) {
    removeTarget.value = null;
    error.value = reason instanceof Error ? reason.message : String(reason);
    toast.err(error.value);
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <section
    class="flex min-w-0 flex-col"
    :aria-label="t('worktree.listTitle')"
    :data-worktree-repo="repoPath"
  >
    <div class="flex min-w-0 items-center gap-0.5">
      <Button
        variant="ghost"
        class="h-auto min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-[var(--radius-sm)] px-1 text-left text-[11px] font-medium text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)] dark:hover:bg-[var(--color-menu-hover)]"
        :aria-expanded="open"
        :aria-label="t('worktree.listTitle')"
        :title="headerHint"
        @click="toggle"
      >
        <ChevronDown
          class="size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
          :class="open ? '' : '-rotate-90'"
          aria-hidden="true"
        />
        <GitBranch class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ t("worktree.listTitle") }}</span>
        <span
          v-if="loaded && worktrees.length"
          class="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[var(--color-chip-bg)] px-1 font-[family-name:var(--font-mono)] text-[10px] font-normal tabular-nums text-[var(--color-mut)]"
        >
          {{ worktrees.length }}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :aria-label="t('worktree.refresh')"
        :title="t('worktree.refresh')"
        :disabled="loading"
        @click="refreshFromHeader"
      >
        <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
      </Button>
    </div>

    <div v-if="open" class="mt-0.5 flex min-w-0 flex-col gap-1 px-1">
      <p
        v-if="error"
        class="m-0 text-[11px] leading-normal text-[var(--color-err)]"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="loading && !loaded"
        class="m-0 text-[11px] text-[var(--color-dim)]"
      >
        {{ t("worktree.listLoading") }}
      </p>
      <p
        v-else-if="loaded && !worktrees.length && !error"
        class="m-0 text-[11px] text-[var(--color-dim)]"
      >
        {{ t("worktree.listEmpty") }}
      </p>

      <ul v-if="worktrees.length" class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li
          v-for="wt in worktrees"
          :key="wt.path"
          :data-worktree-path="wt.path"
          class="relative flex min-w-0 flex-col gap-0.5 rounded-[6px] py-1 pl-1.5 pr-1 transition-colors duration-[var(--motion-fast)]"
          :class="
            wt.current
              ? 'bg-[var(--color-sunken)]'
              : 'hover:bg-[var(--color-menu-hover)]'
          "
        >
          <!-- 当前会话的执行目录：左侧强调条 + 浅底，一眼看出 Agent 正在这里干活 -->
          <span
            v-if="wt.current"
            class="absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-[var(--color-accent)]"
            aria-hidden="true"
          />

          <div class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
            <GitBranch class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
            <span
              class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] leading-4 text-[var(--color-txt)]"
              :title="wt.branch"
            >
              {{ wt.branch }}
            </span>
            <span v-if="wt.kind === 'main'" :class="badgeCls">
              {{ t("worktree.kindMain") }}
            </span>
            <span v-if="wt.sessionId" :class="badgeCls" :title="t('worktree.kindZenTitle')">
              {{ t("worktree.kindZen") }}
            </span>
            <span v-if="wt.current" :class="badgeCls" :title="t('worktree.kindCurrentTitle')">
              {{ t("worktree.kindCurrent") }}
            </span>
            <span
              v-if="wt.locked"
              :class="badgeCls"
              :title="wt.lockReason || t('worktree.kindLockedTitle')"
            >
              {{ t("worktree.kindLocked") }}
            </span>
            <span
              v-if="wt.missing"
              :class="[badgeCls, 'text-[var(--color-err)]']"
              :title="t('worktree.revealDisabled')"
            >
              {{ t("worktree.kindMissing") }}
            </span>
          </div>

          <div class="flex min-w-0 items-center gap-0.5 pl-4">
            <span
              class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[10px] leading-4 text-[var(--color-dim)]"
              :title="wt.path"
            >
              {{ wt.path }}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="t('worktree.reveal')"
              :title="wt.missing ? t('worktree.revealDisabled') : t('worktree.reveal')"
              :disabled="wt.missing"
              @click="revealInFolder(wt)"
            >
              <FolderOpen class="size-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class="size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="t('worktree.openPanel')"
              :title="openPanelTitle(wt)"
              :disabled="!wt.operable"
              @click="openInPanel(wt)"
            >
              <ExternalLink class="size-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class="size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-err)]"
              :aria-label="t('worktree.remove')"
              :title="wt.blockedReason || t('worktree.remove')"
              :disabled="!!wt.blockedReason || removing"
              @click="startRemove(wt)"
            >
              <Trash2 class="size-3" aria-hidden="true" />
            </Button>
          </div>
        </li>
      </ul>
    </div>

    <ConfirmDialog
      :open="!!removeTarget"
      :title="t('worktree.removeTitle')"
      :description="removeDescription"
      :confirm-label="t('worktree.remove')"
      :pending="removing"
      @update:open="(value: boolean) => { if (!value) removeTarget = null; }"
      @confirm="confirmRemove"
    />
  </section>
</template>
