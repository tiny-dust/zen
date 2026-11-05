<script setup lang="ts">
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Check,
  ChevronDown,
  CloudUpload,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import DiffView from "@/components/right/DiffView.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { openAppLink } from "@/lib/browser-element";
import { shortcutDisplayParts } from "@/lib/shortcut-display";
import { useGitStore } from "@/stores/git";

import type {
  GitBranches,
  GitFileChange,
  GitPullRequest,
  GitRepository,
  GitStashEntry,
  GitStatus,
} from "@zen/shared";

/**
 * 会话信息里的单个仓库折叠面板：一个仓库一行头，展开后直接管理该仓库的
 * 变更/diff、分支切换与合并、提交推送拉取、PR 与贮藏。
 * 所有操作都按 repo.path 独立发起，多个仓库面板可同时展开互不干扰。
 */
const props = defineProps<{ repo: GitRepository; open: boolean }>();
const emit = defineEmits<{ toggle: []; openPanel: [path: string] }>();

const { t } = useI18n();
const gitStore = useGitStore();

const loaded = ref(false);
const loading = ref(false);
const error = ref("");
const status = ref<GitStatus | null>(null);
const branches = ref<GitBranches>({ local: [], remote: [] });
const pullRequest = ref<GitPullRequest | null>(null);
const stashes = ref<GitStashEntry[]>([]);
const diffPath = ref("");
const diff = ref("");
const diffLoading = ref(false);
const commitMessage = ref("");
const includeUnstaged = ref(true);
const opBusy = ref("");
const generating = ref(false);
const creatingBranch = ref(false);
const newBranchName = ref("");
/** 新分支的基分支："" = 当前 HEAD，可选本地或远程分支 */
const baseBranch = ref("");
const rootEl = ref<HTMLElement | null>(null);

/** 快捷键绑定：展示文案与下方 onKeydown 的分支判定必须保持一致 */
const SHORTCUTS = {
  commit: "Cmd+Enter",
  commitPush: "Shift+Cmd+Enter",
  push: "Shift+Cmd+U",
  pull: "Shift+Cmd+Y",
  fetch: "Shift+Cmd+E",
  newBranch: "Shift+Cmd+B",
} as const;

/** 悬浮提示：功能 + 快捷键（符号随平台） */
function tip(label: string, key?: string): string {
  return key ? `${label}（${shortcutDisplayParts(key).join("")}）` : label;
}

const displayName = computed(() =>
  props.repo.relativePath === "." ? props.repo.name : props.repo.relativePath,
);

/** 父仓库的 porcelain 会把独立子仓库记作 `?? child/`：只在该子仓库自己的面板展示 */
function withoutNestedRepositories(next: GitStatus, root: string): GitStatus {
  const parent = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const nested = gitStore.repositories
    .map((item) => item.path.replace(/\\/g, "/"))
    .filter((path) => path !== parent && path.startsWith(`${parent}/`))
    .map((path) => path.slice(parent.length + 1));
  if (!nested.length) {
    return next;
  }
  return {
    ...next,
    files: next.files.filter((file) => {
      const path = file.path.replace(/\\/g, "/").replace(/\/+$/, "");
      return !nested.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    }),
  };
}

const files = computed(() => status.value?.files ?? []);
const totalAdd = computed(() => files.value.reduce((sum, item) => sum + item.add, 0));
const totalDel = computed(() => files.value.reduce((sum, item) => sum + item.del, 0));
/** 折叠未加载时用扫描阶段取到的分支摘要，展开后再以完整 status 为准 */
const branch = computed(
  () => status.value?.branch || gitStore.repositoryBranches[props.repo.path] || "",
);
const busying = computed(() => opBusy.value !== "" || generating.value);
const localBranches = computed(() => branches.value.local);
const remoteBranches = computed(() =>
  branches.value.remote.filter((item) => !item.name.endsWith("/HEAD")),
);

function reportError(value: unknown) {
  error.value = value instanceof Error ? value.message : String(value);
}

async function loadStatus() {
  const zen = window.zen;
  if (!zen?.git) return;
  const next = await zen.git.status(props.repo.path);
  status.value = next ? withoutNestedRepositories(next, props.repo.path) : null;
}

async function loadBranches() {
  const zen = window.zen;
  if (!zen?.git) return;
  branches.value = await zen.git.branches(props.repo.path);
}

async function loadStashes() {
  const zen = window.zen;
  if (!zen?.git) return;
  stashes.value = await zen.git.stashList(props.repo.path);
}

async function loadPullRequest() {
  const zen = window.zen;
  if (!zen?.git) return;
  pullRequest.value = await zen.git.pr(props.repo.path);
}

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    await Promise.all([loadStatus(), loadBranches(), loadStashes(), loadPullRequest()]);
    loaded.value = true;
  } catch (reason) {
    reportError(reason);
  } finally {
    loading.value = false;
  }
}

function reset() {
  loaded.value = false;
  status.value = null;
  branches.value = { local: [], remote: [] };
  pullRequest.value = null;
  stashes.value = [];
  diffPath.value = "";
  diff.value = "";
  commitMessage.value = "";
  newBranchName.value = "";
  error.value = "";
}

watch(
  () => props.repo.path,
  () => {
    reset();
    if (props.open) void refresh();
  },
);

watch(
  () => props.open,
  (open) => {
    if (open && !loaded.value) void refresh();
  },
  { immediate: true },
);

async function withOp(name: string, action: () => Promise<void>) {
  if (busying.value) return;
  opBusy.value = name;
  error.value = "";
  try {
    await action();
  } catch (reason) {
    reportError(reason);
  } finally {
    opBusy.value = "";
  }
}

async function selectFile(change: GitFileChange) {
  if (diffPath.value === change.path) {
    diffPath.value = "";
    diff.value = "";
    return;
  }
  diffPath.value = change.path;
  diff.value = "";
  diffLoading.value = true;
  try {
    const zen = window.zen;
    if (!zen?.git) return;
    let raw: string | null = null;
    if (change.untracked) {
      const content = await zen.workspace.readFile(props.repo.path, change.path);
      raw = content?.content
        ? `diff --git a/${change.path} b/${change.path}\n@@ -0,0 +1 @@\n${content.content
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n")}`
        : null;
    } else {
      raw = await zen.git.diff(props.repo.path, change.path);
      if (!raw) {
        raw = await zen.git.diff(props.repo.path, change.path, true);
      }
    }
    if (diffPath.value === change.path) {
      diff.value = raw ?? "";
    }
  } catch (reason) {
    reportError(reason);
  } finally {
    diffLoading.value = false;
  }
}

async function checkout(name: string) {
  if (busying.value || name === branch.value) return;
  await withOp("checkout", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    // 远端分支去掉 remote 前缀交给 git DWIM 建本地跟踪分支
    const result = await zen.git.checkout(props.repo.path, name);
    if (!result.ok) {
      error.value = result.error ?? t("shell.switchBranchFailed");
      return;
    }
    await Promise.all([loadStatus(), loadBranches()]);
  });
}

async function merge(name: string) {
  if (busying.value) return;
  await withOp("merge", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result = await zen.git.merge(props.repo.path, name);
    if (!result.ok) {
      error.value = result.error ?? t("shell.mergeFailed");
      return;
    }
    await loadStatus();
  });
}

async function createBranch() {
  const name = newBranchName.value.trim();
  if (!name || busying.value) return;
  await withOp("branch", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result = await zen.git.createBranch(
      props.repo.path,
      name,
      baseBranch.value || undefined,
    );
    if (!result.ok) {
      error.value = result.error ?? t("shell.createBranchFailed");
      return;
    }
    newBranchName.value = "";
    baseBranch.value = "";
    creatingBranch.value = false;
    await Promise.all([loadStatus(), loadBranches()]);
  });
}

/** 基分支候选：本地排除当前分支，远程排除各 remote 的 HEAD 指针 */
const baseLocalBranches = computed(() => localBranches.value.filter((item) => !item.current));
const baseLabel = computed(() =>
  baseBranch.value
    ? baseBranch.value
    : `${t("shell.currentBranch")}${branch.value ? `（${branch.value}）` : ""}`,
);

/** 快捷键动作 → 已有操作函数 */
type GitShortcutAction = "commit" | "commit-push" | "push" | "pull" | "fetch" | "new-branch";

function shortcutAction(event: KeyboardEvent): GitShortcutAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === "Enter") {
    return event.shiftKey ? "commit-push" : "commit";
  }
  if (!event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case "u":
      return "push";
    case "y":
      return "pull";
    case "e":
      return "fetch";
    case "b":
      return "new-branch";
    default:
      return null;
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

/** 多仓库同时展开时只让焦点所在面板或当前目录仓库响应，避免一次点击触发多次操作 */
function ownsShortcut(): boolean {
  if (!props.open) return false;
  const active = document.activeElement;
  if (active && rootEl.value?.contains(active)) return true;
  const cwd = gitStore.cwd();
  if (!cwd) return false;
  const repoPath = props.repo.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const current = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return current === repoPath || current.startsWith(`${repoPath}/`);
}

/** 有弹层（提交弹窗 / 设置 / 分支菜单）打开时不抢键：弹层内有自己的提交手势与键盘导航 */
function hasOpenOverlay(): boolean {
  return !!document.querySelector('[role="dialog"], [role="menu"]');
}

function onKeydown(event: KeyboardEvent) {
  const action = shortcutAction(event);
  if (!action) return;
  // 输入框内只保留提交手势，其余 git 快捷键让位给输入
  if (isTextEntry(event.target) && action !== "commit" && action !== "commit-push") return;
  if (hasOpenOverlay()) return;
  if (!ownsShortcut()) return;
  event.preventDefault();
  switch (action) {
    case "commit":
      void commit("commit");
      break;
    case "commit-push":
      void commit("commit-push");
      break;
    case "push":
      void sync("push");
      break;
    case "pull":
      void sync("pull");
      break;
    case "fetch":
      void sync("fetch");
      break;
    case "new-branch":
      creatingBranch.value = true;
      break;
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function commitPaths(): string[] {
  return files.value
    .filter((item) => includeUnstaged.value || (item.x !== " " && !item.untracked))
    .map((item) => item.path);
}

async function commit(mode: "commit" | "commit-push") {
  if (busying.value || !files.value.length) return;
  await withOp(mode, async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const paths = commitPaths();
    if (!paths.length) return;
    const message = commitMessage.value.trim();
    const result = message
      ? await zen.git.commit(props.repo.path, message, paths, {
          push: mode === "commit-push",
          includeUnstaged: includeUnstaged.value,
        })
      : await zen.git.commitBatched(props.repo.path, paths, {
          push: mode === "commit-push",
          model: gitStore.completionModel(),
        });
    if (!result.ok) {
      error.value = result.error ?? t("shell.commitFailed");
      return;
    }
    commitMessage.value = "";
    await Promise.all([loadStatus(), loadStashes()]);
  });
}

async function generateMessage() {
  if (generating.value || !files.value.length) return;
  generating.value = true;
  error.value = "";
  try {
    const zen = window.zen;
    if (!zen?.git) return;
    const text = await zen.git.aiMessage(props.repo.path, gitStore.completionModel());
    if (text) {
      commitMessage.value = text;
    } else if (!commitMessage.value.trim()) {
      error.value = t("shell.aiMessageEmpty");
    }
  } catch (reason) {
    reportError(reason);
  } finally {
    generating.value = false;
  }
}

async function sync(kind: "push" | "pull" | "fetch") {
  if (busying.value) return;
  await withOp(kind, async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result =
      kind === "push"
        ? await zen.git.push(props.repo.path)
        : kind === "pull"
          ? await zen.git.pull(props.repo.path)
          : await zen.git.fetch(props.repo.path);
    if (!result.ok) {
      error.value = result.error ?? t("shell.operationFailed");
      return;
    }
    await Promise.all([loadStatus(), loadBranches()]);
  });
}

async function stashPush() {
  if (busying.value || !files.value.length) return;
  await withOp("stash", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result = await zen.git.stashPush(props.repo.path);
    if (!result.ok) {
      error.value = result.error ?? t("app.git.stashFailed");
      return;
    }
    await Promise.all([loadStatus(), loadStashes()]);
  });
}

async function stashApply(index: number, mode: "apply" | "pop") {
  if (busying.value) return;
  await withOp("stash", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result = await zen.git.stashApply(props.repo.path, index, mode);
    if (!result.ok) {
      error.value = result.error ?? t("app.git.stashApplyFailed");
      return;
    }
    await Promise.all([loadStatus(), loadStashes()]);
  });
}

async function stashDrop(index: number) {
  if (busying.value) return;
  await withOp("stash", async () => {
    const zen = window.zen;
    if (!zen?.git) return;
    const result = await zen.git.stashDrop(props.repo.path, index);
    if (!result.ok) {
      error.value = result.error ?? t("app.git.stashDropFailed");
      return;
    }
    await loadStashes();
  });
}

const rowCls = "flex w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left";
const linkCls = "text-[var(--color-link)] hover:underline";
/** 分组内操作按钮：图标 + 文字（11px），一排纯图标难以分辨 */
const actCls = "h-6 gap-1 px-1.5 text-[11px] font-normal";
/** 分组标题：小号弱化文字，只承担分组标识 */
const blockLabelCls = "text-[10px] font-medium text-[var(--color-mut)]";
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-[10px] border transition-colors duration-[var(--motion-fast)]"
    :class="
      open
        ? 'border-[var(--color-line)] bg-[var(--color-sunken)]'
        : 'border-[var(--color-line-soft)] hover:border-[var(--color-line)]'
    "
  >
    <!-- 仓库头：第一行仓库名 + 变更统计，第二行分支与同步状态。
         名称与分支各自占一行，互不挤占；行内省略时 title 提供完整值，展开后可见全文。 -->
    <div class="flex min-w-0 items-start gap-0.5 py-1 pl-1 pr-1.5">
      <Button
        variant="ghost"
        class="flex h-auto min-w-0 flex-1 flex-col items-stretch rounded-[6px] px-1 py-1 text-left hover:bg-[var(--color-menu-hover)]"
        :aria-expanded="open"
        @click="emit('toggle')"
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <ChevronDown
            class="size-3.5 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="open ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <FolderGit2 class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-txt-strong)]"
            :title="repo.path"
          >
            {{ displayName }}
          </span>
          <span
            v-if="files.length"
            class="flex-none font-[family-name:var(--font-mono)] text-[10px] tabular-nums"
          >
            <span class="text-[var(--color-add)]">+{{ totalAdd }}</span>
            <span class="text-[var(--color-del)]">&nbsp;-{{ totalDel }}</span>
          </span>
          <span v-else-if="loaded" class="flex-none text-[10px] text-[var(--color-dim)]">
            {{ t("shell.repoClean") }}
          </span>
        </span>

        <span
          class="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5 text-[10px] text-[var(--color-mut)]"
        >
          <GitBranch class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px]"
            :title="branch || t('shell.noWorkdir')"
          >
            {{ branch || t("shell.noWorkdir") }}
          </span>
          <span
            v-if="status?.ahead || status?.behind"
            class="flex-none font-[family-name:var(--font-mono)]"
            :title="t('shell.upstreamDiffTitle')"
          >
            <span v-if="status?.ahead" class="text-[var(--color-add)]">↑{{ status.ahead }}</span>
            <span v-if="status?.behind" class="text-[var(--color-err)]">&nbsp;↓{{ status.behind }}</span>
          </span>
          <span
            v-if="files.length"
            class="flex-none rounded-full bg-[var(--color-chip-bg)] px-1.5 py-px font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-mut)]"
            :title="t('shell.changedFiles')"
          >
            {{ files.length }}
          </span>
        </span>
      </Button>

      <Button
        variant="ghost"
        size="icon-xs"
        class="mt-0.5 size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :aria-label="t('shell.refreshRepo')"
        :title="t('shell.refreshRepo')"
        :disabled="loading"
        @click="refresh"
      >
        <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="mt-0.5 size-6 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :aria-label="t('shell.openInGitPanel')"
        :title="t('shell.openInGitPanel')"
        @click="emit('openPanel', repo.path)"
      >
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </Button>
    </div>

    <!-- 展开体：三个命名分组，用发丝线分隔；每组自带标题，跨仓库也能看清属于哪个仓库 -->
    <div v-if="open" ref="rootEl" class="flex min-w-0 flex-col border-t border-[var(--color-line-soft)]">
      <p v-if="loading && !loaded" class="m-0 px-2 py-2 text-[11px] text-[var(--color-dim)]">
        {{ t("shell.loadingRepos") }}
      </p>

      <!-- 变更 -->
      <div class="flex min-w-0 flex-col gap-1 px-2 py-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span :class="blockLabelCls">{{ t("shell.changedFiles") }}</span>
          <span
            v-if="files.length"
            class="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[var(--color-chip-bg)] px-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-mut)]"
          >
            {{ files.length }}
          </span>
          <span v-else-if="loaded" class="text-[10px] text-[var(--color-dim)]">
            {{ t("shell.repoClean") }}
          </span>
        </div>

        <template v-for="change in files" :key="change.path">
          <button
            type="button"
            :class="[
              rowCls,
              'hover:bg-[var(--color-menu-hover)]',
              diffPath === change.path ? 'bg-[var(--color-menu-hover)]' : '',
            ]"
            :title="change.path"
            @click="selectFile(change)"
          >
            <span
              class="w-3 flex-none text-center font-[family-name:var(--font-mono)] text-[10px]"
              :class="gitStore.statusBadge(change).cls"
            >
              {{ gitStore.statusBadge(change).text }}
            </span>
            <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px]">
              {{ change.path }}
            </span>
            <span class="flex-none font-[family-name:var(--font-mono)] text-[10px] tabular-nums">
              <span class="text-[var(--color-add)]">+{{ change.add }}</span>
              <span class="text-[var(--color-del)]">&nbsp;-{{ change.del }}</span>
            </span>
          </button>
          <div
            v-if="diffPath === change.path"
            class="my-0.5 max-h-[240px] min-w-0 overflow-auto rounded-md border border-[var(--color-line-soft)]"
          >
            <p v-if="diffLoading" class="m-0 p-2 text-[11px] text-[var(--color-dim)]">
              {{ t("panels.loadingDiff") }}
            </p>
            <DiffView v-else-if="diff" :diff="diff" :path="change.path" />
            <p v-else class="m-0 p-2 text-[11px] text-[var(--color-dim)]">
              {{ t("panels.noDiffContent") }}
            </p>
          </div>
        </template>
      </div>

      <!-- 提交：输入在上，动作为一行（AI 生成 / 提交 / 提交并推送） -->
      <div
        class="flex min-w-0 flex-col gap-1.5 border-t border-[var(--color-line-soft)] px-2 py-2"
      >
        <span :class="blockLabelCls">{{ t("shell.commitOrPush") }}</span>
        <Textarea
          v-model="commitMessage"
          rows="2"
          class="min-h-[48px] resize-none text-[12px]"
          :placeholder="t('shell.commitMessagePlaceholder')"
          :disabled="generating"
        />
        <div class="flex min-w-0 flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            :aria-label="t('shell.aiGenerate')"
            :title="t('shell.aiGenerateTitle')"
            :disabled="generating || !files.length"
            @click="generateMessage"
          >
            <LoaderCircle v-if="generating" class="size-3 animate-spin" aria-hidden="true" />
            <Sparkles v-else class="size-3" aria-hidden="true" />
            {{ t("shell.aiGenerate") }}
          </Button>
          <Button
            variant="outline"
            size="xs"
            :class="actCls"
            aria-label="提交"
            :title="tip(t('shell.commit'), SHORTCUTS.commit)"
            :disabled="busying || !files.length"
            @click="commit('commit')"
          >
            <LoaderCircle v-if="opBusy === 'commit'" class="size-3 animate-spin" aria-hidden="true" />
            <GitCommitHorizontal v-else class="size-3" aria-hidden="true" />
            {{ t("shell.commit") }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            aria-label="提交并推送"
            :title="tip(t('shell.commitAndPush'), SHORTCUTS.commitPush)"
            :disabled="busying || !files.length"
            @click="commit('commit-push')"
          >
            <LoaderCircle
              v-if="opBusy === 'commit-push'"
              class="size-3 animate-spin"
              aria-hidden="true"
            />
            <CloudUpload v-else class="size-3" aria-hidden="true" />
            {{ t("shell.commitAndPush") }}
          </Button>
          <label
            class="ml-auto flex flex-none cursor-pointer items-center gap-1.5 text-[10px] text-[var(--color-mut)]"
          >
            <Checkbox v-model="includeUnstaged" class="size-3.5" />
            {{ t("shell.includeUnstaged") }}
          </label>
        </div>
      </div>

      <!-- 分支与同步：分支全名独占一行（可换行，不省略），动作按「分支 / 同步」两组 -->
      <div
        class="flex min-w-0 flex-col gap-1 border-t border-[var(--color-line-soft)] px-2 py-2"
      >
        <div class="flex min-w-0 items-baseline gap-1.5">
          <span :class="[blockLabelCls, 'flex-none']">{{ t("shell.branchLabel") }}</span>
          <span
            class="min-w-0 flex-1 break-all font-[family-name:var(--font-mono)] text-[11px] leading-4 text-[var(--color-txt)]"
          >
            {{ branch || t("shell.noWorkdir") }}
          </span>
        </div>

        <div class="flex min-w-0 flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="xs"
                :class="actCls"
                :aria-label="t('shell.switchBranch')"
                :title="t('shell.switchBranch')"
              >
                <ArrowRightLeft class="size-3" aria-hidden="true" />
                {{ t("shell.switchShort") }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-[280px] w-[220px] overflow-auto">
              <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
                {{ t("shell.localBranches") }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="item in localBranches"
                :key="item.name"
                class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
                @select="checkout(item.name)"
              >
                <Check v-if="item.current" class="size-3.5 flex-none" aria-hidden="true" />
                <span v-else class="size-3.5 flex-none" aria-hidden="true" />
                <span class="truncate">{{ item.name }}</span>
              </DropdownMenuItem>
              <DropdownMenuLabel class="mt-1 text-[11px] text-[var(--color-dim)]">
                {{ t("shell.remoteBranches") }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="item in remoteBranches"
                :key="item.name"
                class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
                @select="checkout(item.name)"
              >
                <span class="size-3.5 flex-none" aria-hidden="true" />
                <span class="truncate">{{ item.name }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="xs"
                :class="actCls"
                :aria-label="t('shell.mergeBranch')"
                :title="t('shell.mergeBranch')"
                :disabled="!localBranches.length && !remoteBranches.length"
              >
                <GitMerge class="size-3" aria-hidden="true" />
                {{ t("shell.mergeShort") }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-[280px] w-[220px] overflow-auto">
              <DropdownMenuItem
                v-for="item in [...localBranches, ...remoteBranches].filter((entry) => !entry.current)"
                :key="item.name"
                class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
                @select="merge(item.name)"
              >
                <span class="truncate">{{ item.name }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            :aria-label="t('shell.newBranch')"
            :title="tip(t('shell.newBranch'), SHORTCUTS.newBranch)"
            @click="creatingBranch = !creatingBranch"
          >
            <GitBranchPlus class="size-3" aria-hidden="true" />
            {{ t("shell.newBranchShort") }}
          </Button>

          <span class="mx-1 h-3.5 w-px flex-none bg-[var(--color-line)]" aria-hidden="true" />

          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            :aria-label="t('panels.pull')"
            :title="tip(t('panels.pull'), SHORTCUTS.pull)"
            :disabled="busying"
            @click="sync('pull')"
          >
            <LoaderCircle v-if="opBusy === 'pull'" class="size-3 animate-spin" aria-hidden="true" />
            <ArrowDown v-else class="size-3" aria-hidden="true" />
            {{ t("shell.pullShort") }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            :aria-label="t('shell.push')"
            :title="tip(t('shell.push'), SHORTCUTS.push)"
            :disabled="busying"
            @click="sync('push')"
          >
            <LoaderCircle v-if="opBusy === 'push'" class="size-3 animate-spin" aria-hidden="true" />
            <ArrowUp v-else class="size-3" aria-hidden="true" />
            {{ t("shell.pushShort") }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            :class="actCls"
            :aria-label="t('panels.fetch')"
            :title="tip(t('panels.fetch'), SHORTCUTS.fetch)"
            :disabled="busying"
            @click="sync('fetch')"
          >
            <LoaderCircle v-if="opBusy === 'fetch'" class="size-3 animate-spin" aria-hidden="true" />
            <RefreshCw v-else class="size-3" aria-hidden="true" />
            {{ t("shell.fetchShort") }}
          </Button>
        </div>

        <!-- 新建分支：名称 + 基分支（当前 HEAD / 本地分支 / 远程分支） -->
        <div v-if="creatingBranch" class="mt-0.5 flex min-w-0 items-center gap-1">
          <Input
            v-model="newBranchName"
            class="h-6 max-w-[150px] flex-1 px-1.5 text-[11px]"
            :placeholder="t('shell.newBranchName')"
            @keydown.enter="createBranch"
          />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 min-w-0 max-w-[130px] gap-1 px-1.5 text-[11px] font-normal"
                :aria-label="t('shell.baseBranch')"
                :title="t('shell.baseBranchTitle')"
              >
                <GitBranchPlus class="size-3 flex-none" aria-hidden="true" />
                <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ baseLabel }}</span>
                <ChevronDown class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-[260px] w-[220px] overflow-auto">
              <DropdownMenuItem class="gap-1.5 text-[12px]" @select="baseBranch = ''">
                <Check v-if="!baseBranch" class="size-3.5 flex-none" aria-hidden="true" />
                <span v-else class="size-3.5 flex-none" aria-hidden="true" />
                <span class="min-w-0 truncate">
                  {{ t("shell.currentBranch") }}<template v-if="branch">（{{ branch }}）</template>
                </span>
              </DropdownMenuItem>
              <DropdownMenuLabel class="mt-1 text-[11px] text-[var(--color-dim)]">
                {{ t("shell.localBranches") }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="item in baseLocalBranches"
                :key="`base-local-${item.name}`"
                class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
                @select="baseBranch = item.name"
              >
                <Check v-if="baseBranch === item.name" class="size-3.5 flex-none" aria-hidden="true" />
                <span v-else class="size-3.5 flex-none" aria-hidden="true" />
                <span class="truncate">{{ item.name }}</span>
              </DropdownMenuItem>
              <DropdownMenuLabel class="mt-1 text-[11px] text-[var(--color-dim)]">
                {{ t("shell.remoteBranches") }}
              </DropdownMenuLabel>
              <DropdownMenuItem
                v-for="item in remoteBranches"
                :key="`base-remote-${item.name}`"
                class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
                @select="baseBranch = item.name"
              >
                <Check v-if="baseBranch === item.name" class="size-3.5 flex-none" aria-hidden="true" />
                <span v-else class="size-3.5 flex-none" aria-hidden="true" />
                <span class="truncate">{{ item.name }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-6 flex-none text-[var(--color-mut)] hover:text-[var(--color-txt)]"
            :aria-label="t('shell.create')"
            :title="t('shell.create')"
            :disabled="!newBranchName.trim() || busying"
            @click="createBranch"
          >
            <Check class="size-3.5" aria-hidden="true" />
          </Button>
        </div>

        <!-- PR：只在存在时占位，避免「暂无」文案占版面 -->
        <p
          v-if="pullRequest"
          class="m-0 flex min-w-0 items-center gap-1 text-[11px] text-[var(--color-mut)]"
        >
          <span class="min-w-0 flex-1 truncate" :title="pullRequest.title">
            PR #{{ pullRequest.number }} · {{ pullRequest.title }}
          </span>
          <a
            :href="pullRequest.url"
            :class="linkCls"
            target="_blank"
            rel="noreferrer"
            @click.prevent.stop="openAppLink(pullRequest.url)"
          >
            <ExternalLink class="size-3" aria-hidden="true" />
          </a>
        </p>
      </div>

      <!-- 贮藏：入口与列表同处一组，避免和其它操作混在一起 -->
      <div
        v-if="files.length || stashes.length"
        class="flex min-w-0 flex-col gap-1 border-t border-[var(--color-line-soft)] px-2 py-2"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span :class="blockLabelCls">{{ t("shell.stashLabel") }}</span>
          <span
            v-if="stashes.length"
            class="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[var(--color-chip-bg)] px-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-mut)]"
          >
            {{ stashes.length }}
          </span>
          <Button
            variant="ghost"
            size="xs"
            class="ml-auto h-6 flex-none gap-1 px-1.5 text-[11px] font-normal"
            :aria-label="t('panels.stashChanges')"
            :title="t('panels.stashChanges')"
            :disabled="busying || !files.length"
            @click="stashPush"
          >
            <Archive class="size-3" aria-hidden="true" />
            {{ t("panels.stashChanges") }}
          </Button>
        </div>
        <div
          v-for="item in stashes"
          :key="item.index"
          class="flex min-w-0 items-center gap-1 rounded-md px-0.5 py-0.5 hover:bg-[var(--color-menu-hover)]"
        >
          <span class="min-w-0 flex-1 truncate text-[11px]" :title="item.message">
            stash@{{ item.index }} · {{ item.message }}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
            :aria-label="t('panels.applyStash')"
            :title="t('panels.applyStash')"
            :disabled="busying"
            @click="stashApply(item.index, 'apply')"
          >
            <ArchiveRestore class="size-3" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none text-[var(--color-dim)] hover:text-[var(--color-danger-fg)]"
            :aria-label="t('panels.dropStash')"
            :title="t('panels.dropStash')"
            :disabled="busying"
            @click="stashDrop(item.index)"
          >
            <Trash2 class="size-3" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <p v-if="error" class="m-0 px-2 pb-2 text-[11px] text-[var(--color-err)]" role="alert">
        {{ error }}
      </p>
    </div>
  </section>
</template>
