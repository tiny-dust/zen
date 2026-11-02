<script setup lang="ts">
import {
  Archive,
  ArrowRightLeft,
  Check,
  ChevronDown,
  CloudDownload,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitMerge,
  LoaderCircle,
  Plus,
  RefreshCw,
  Upload,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
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
    const result = await zen.git.createBranch(props.repo.path, name);
    if (!result.ok) {
      error.value = result.error ?? t("shell.createBranchFailed");
      return;
    }
    newBranchName.value = "";
    creatingBranch.value = false;
    await Promise.all([loadStatus(), loadBranches()]);
  });
}

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

const rowCls = "flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left";
const subHeadCls =
  "m-0 flex items-center gap-1.5 px-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-dim)]";
const linkCls = "text-[var(--color-link)] hover:underline";
</script>

<template>
  <section class="flex min-w-0 flex-col">
    <div class="flex min-w-0 items-center gap-0.5">
      <Button
        variant="ghost"
        class="flex h-auto min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-sm)] px-1 text-left text-[12px] font-normal text-[var(--color-txt-strong)] hover:bg-transparent dark:hover:bg-transparent"
        :aria-expanded="open"
        @click="emit('toggle')"
      >
        <ChevronDown
          class="size-3.5 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
          :class="open ? '' : '-rotate-90'"
          aria-hidden="true"
        />
        <FolderGit2 class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span class="min-w-0 truncate" :title="repo.path">{{ displayName }}</span>
        <span
          v-if="branch"
          class="min-w-0 max-w-[45%] truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        >
          {{ branch }}
        </span>
        <span
          v-if="status?.ahead || status?.behind"
          class="flex-none font-[family-name:var(--font-mono)] text-[10px]"
          :title="t('shell.upstreamDiffTitle')"
        >
          <span v-if="status?.ahead" class="text-[var(--color-add)]">↑{{ status.ahead }}</span>
          <span v-if="status?.behind" class="text-[var(--color-err)]">&nbsp;↓{{ status.behind }}</span>
        </span>
        <span
          v-if="files.length"
          class="ml-auto flex-none font-[family-name:var(--font-mono)] text-[10px] tabular-nums"
        >
          <span class="text-[var(--color-add)]">+{{ totalAdd }}</span>
          <span class="text-[var(--color-del)]">&nbsp;-{{ totalDel }}</span>
        </span>
        <span v-else-if="loaded" class="ml-auto flex-none text-[10px] text-[var(--color-dim)]">
          {{ t("shell.repoClean") }}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-7 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
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
        class="size-7 flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :aria-label="t('shell.openInGitPanel')"
        :title="t('shell.openInGitPanel')"
        @click="emit('openPanel', repo.path)"
      >
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </Button>
    </div>

    <div v-if="open" class="mt-0.5 flex min-w-0 flex-col gap-0.5 pl-1">
      <p v-if="loading && !loaded" class="m-0 px-1 py-1 text-[11px] text-[var(--color-dim)]">
        {{ t("shell.loadingRepos") }}
      </p>

      <!-- 变更文件 + inline diff -->
      <p :class="subHeadCls">{{ t("shell.changedFiles") }}</p>
      <p v-if="loaded && !files.length" class="m-0 px-1 text-[11px] text-[var(--color-dim)]">
        {{ t("shell.repoClean") }}
      </p>
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

      <!-- 分支 -->
      <p :class="subHeadCls">
        {{ t("shell.branchLabel") }}
        <span class="normal-case tracking-normal">{{ branch || "—" }}</span>
      </p>
      <div class="flex min-w-0 flex-wrap items-center gap-1 px-1">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" class="h-6 gap-1 px-1.5 text-[11px] font-normal">
              <ArrowRightLeft class="size-3" aria-hidden="true" />
              {{ t("shell.switchBranch") }}
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
              size="sm"
              class="h-6 gap-1 px-1.5 text-[11px] font-normal"
              :disabled="!localBranches.length && !remoteBranches.length"
            >
              <GitMerge class="size-3" aria-hidden="true" />
              {{ t("shell.mergeBranch") }}
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
          size="sm"
          class="h-6 gap-1 px-1.5 text-[11px] font-normal"
          @click="creatingBranch = !creatingBranch"
        >
          <Plus class="size-3" aria-hidden="true" />
          {{ t("shell.newBranch") }}
        </Button>
      </div>
      <div v-if="creatingBranch" class="flex min-w-0 items-center gap-1 px-1 pt-1">
        <Input
          v-model="newBranchName"
          class="h-6 max-w-[160px] flex-1 px-1.5 text-[11px]"
          :placeholder="t('shell.newBranchName')"
          @keydown.enter="createBranch"
        />
        <Button
          size="sm"
          class="h-6 px-2 text-[11px]"
          :disabled="!newBranchName.trim() || busying"
          @click="createBranch"
        >
          {{ t("shell.create") }}
        </Button>
      </div>

      <!-- 提交 / 推送 / 拉取 -->
      <p :class="subHeadCls">{{ t("shell.commitOrPush") }}</p>
      <div class="flex min-w-0 flex-col gap-1 px-1">
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
            size="sm"
            class="h-6 gap-1 px-1.5 text-[11px] font-normal"
            :disabled="generating || !files.length"
            @click="generateMessage"
          >
            <LoaderCircle v-if="generating" class="size-3 animate-spin" aria-hidden="true" />
            <RefreshCw v-else class="size-3" aria-hidden="true" />
            {{ generating ? t("shell.generating") : t("shell.aiGenerate") }}
          </Button>
          <Button
            size="sm"
            class="h-6 px-2 text-[11px]"
            :disabled="busying || !files.length"
            @click="commit('commit')"
          >
            {{ t("shell.commit") }}
          </Button>
          <Button
            size="sm"
            class="h-6 px-2 text-[11px]"
            :disabled="busying || !files.length"
            @click="commit('commit-push')"
          >
            {{ t("shell.commitAndPush") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 px-1.5 text-[11px] font-normal"
            :disabled="busying"
            @click="sync('push')"
          >
            <Upload class="size-3" aria-hidden="true" />
            {{ t("shell.push") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 px-1.5 text-[11px] font-normal"
            :disabled="busying"
            @click="sync('pull')"
          >
            <CloudDownload class="size-3" aria-hidden="true" />
            {{ t("panels.pull") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 px-1.5 text-[11px] font-normal"
            :disabled="busying"
            @click="sync('fetch')"
          >
            <RefreshCw class="size-3" aria-hidden="true" />
            {{ t("panels.fetch") }}
          </Button>
        </div>
        <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-mut)]">
          <Checkbox v-model="includeUnstaged" class="size-3.5" />
          {{ t("shell.includeUnstaged") }}
        </label>
      </div>

      <!-- PR -->
      <p :class="subHeadCls">{{ t("shell.pullRequest") }}</p>
      <p class="m-0 flex min-w-0 items-center gap-1 px-1 text-[11px] text-[var(--color-mut)]">
        <template v-if="pullRequest">
          <span class="min-w-0 flex-1 truncate">PR #{{ pullRequest.number }} · {{ pullRequest.title }}</span>
          <a
            :href="pullRequest.url"
            :class="linkCls"
            target="_blank"
            rel="noreferrer"
            @click.prevent.stop="openAppLink(pullRequest.url)"
          >
            <ExternalLink class="size-3" aria-hidden="true" />
          </a>
        </template>
        <span v-else class="truncate">{{ t("shell.noPullRequest") }}</span>
      </p>

      <!-- 贮藏 -->
      <p :class="subHeadCls">
        {{ t("shell.stashLabel") }}
        <span v-if="stashes.length" class="normal-case tracking-normal">{{ stashes.length }}</span>
      </p>
      <div class="flex min-w-0 flex-col gap-0.5 px-1">
        <Button
          variant="ghost"
          size="sm"
          class="h-6 w-fit gap-1 px-1.5 text-[11px] font-normal"
          :disabled="busying || !files.length"
          @click="stashPush"
        >
          <Archive class="size-3" aria-hidden="true" />
          {{ t("panels.stashChanges") }}
        </Button>
        <p v-if="!stashes.length" class="m-0 text-[11px] text-[var(--color-dim)]">
          {{ t("panels.noStashes") }}
        </p>
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
            <GitBranch class="size-3" aria-hidden="true" />
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
            <Archive class="size-3" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <p v-if="error" class="m-0 px-1 text-[11px] text-[var(--color-err)]" role="alert">
        {{ error }}
      </p>
    </div>
  </section>
</template>
