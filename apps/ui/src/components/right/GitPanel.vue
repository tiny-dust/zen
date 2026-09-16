<script setup lang="ts">
import {
  ChevronDown,
  GitBranch,
  GitBranchPlus,
  Loader2,
  RefreshCw,
  Sparkles,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { GitFileChange, GitLogEntry } from "@zen/shared";

const props = defineProps<{
  /** 会话绑定的工作区目录；空 = 公共区 */
  root?: string;
}>();

type ViewKind = "changes" | "graph";
const view = ref<ViewKind>("changes");
const loading = ref(false);
const status = ref<{ branch: string; files: GitFileChange[] } | null>(null);
const checked = ref(new Set<string>());
const selectedPath = ref("");
const diff = ref("");
const message = ref("");
const generating = ref(false);
const committing = ref(false);
const feedback = ref("");
const log = ref<GitLogEntry[]>([]);
const branchCreating = ref(false);
const branchName = ref("");
const branchError = ref("");
const diffOpen = ref(true);

const changeList = computed(() => status.value?.files ?? []);
const checkedPaths = computed(() =>
  changeList.value.filter((item) => checked.value.has(item.path)).map((item) => item.path),
);
const allChecked = computed(
  () => changeList.value.length > 0 && checkedPaths.value.length === changeList.value.length,
);

function statusBadge(change: GitFileChange): { text: string; cls: string } {
  const code = change.untracked ? "?" : change.x !== " " ? change.x : change.y;
  if (code === "M") {
    return { text: "M", cls: "text-[var(--color-accent)]" };
  }
  if (code === "A") {
    return { text: "A", cls: "text-[var(--color-add)]" };
  }
  if (code === "D") {
    return { text: "D", cls: "text-[var(--color-del)]" };
  }
  if (code === "U") {
    return { text: "U", cls: "text-[var(--color-blue)]" };
  }
  return { text: code, cls: "text-[var(--color-mut)]" };
}

async function refresh() {
  const zen = window.zen;
  if (!zen?.git || !props.root) {
    return;
  }
  loading.value = true;
  try {
    status.value = await zen.git.status(props.root);
    const valid = new Set(changeList.value.map((item) => item.path));
    checked.value = new Set([...checked.value].filter((path) => valid.has(path)));
    if (!selectedPath.value && changeList.value.length) {
      void selectFile(changeList.value[0].path);
    }
  } finally {
    loading.value = false;
  }
}

async function refreshGraph() {
  const zen = window.zen;
  if (!zen?.git || !props.root) {
    return;
  }
  log.value = await zen.git.log(props.root);
}

async function selectFile(path: string) {
  selectedPath.value = path;
  diffOpen.value = true;
  const zen = window.zen;
  if (!zen?.git) {
    return;
  }
  diff.value = (await zen.git.diff(props.root, path)) ?? "（无未暂存 diff）";
}

function toggleAll() {
  checked.value = allChecked.value
    ? new Set()
    : new Set(changeList.value.map((item) => item.path));
}

function toggle(path: string) {
  const next = new Set(checked.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  checked.value = next;
}

async function generateMessage() {
  const zen = window.zen;
  if (!zen?.git) {
    return;
  }
  generating.value = true;
  feedback.value = "";
  try {
    const text = await zen.git.aiMessage(props.root);
    if (text) {
      message.value = text;
    } else {
      feedback.value = "模型未返回内容";
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "生成失败";
  } finally {
    generating.value = false;
  }
}

async function submit(push: boolean) {
  const zen = window.zen;
  if (!zen?.git || committing.value) {
    return;
  }
  committing.value = true;
  feedback.value = "";
  try {
    const result = await zen.git.commit(
      props.root,
      message.value,
      checkedPaths.value.length ? checkedPaths.value : changeList.value.map((item) => item.path),
      push,
    );
    if (result.ok) {
      feedback.value = push ? "已提交并推送" : "已提交";
      message.value = "";
      await refresh();
      if (view.value === "graph") {
        await refreshGraph();
      }
    } else {
      feedback.value = result.error ?? "提交失败";
    }
  } finally {
    committing.value = false;
  }
}

async function createBranch() {
  const zen = window.zen;
  if (!zen?.git || !branchName.value.trim()) {
    return;
  }
  branchError.value = "";
  const result = await zen.git.createBranch(props.root, branchName.value);
  if (result.ok) {
    feedback.value = `已创建并切换到 ${branchName.value.trim()}`;
    branchName.value = "";
    branchCreating.value = false;
    await Promise.all([refresh(), refreshGraph()]);
  } else {
    branchError.value = result.error ?? "创建分支失败";
  }
}

watch(
  () => props.root,
  () => {
    status.value = null;
    selectedPath.value = "";
    diff.value = "";
    message.value = "";
    branchCreating.value = false;
    void refresh();
    void refreshGraph();
  },
  { immediate: true },
);

function rowCls(active: boolean) {
  return cn(
    "flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px]",
    active ? "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]" : "text-[var(--color-txt)]",
    "hover:bg-[var(--color-menu-hover)]",
  );
}

function segmentCls(active: boolean) {
  return cn(
    "h-6 rounded-md px-2 text-[12px]",
    active
      ? "bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]"
      : "text-[var(--color-mut)] hover:text-[var(--color-txt)]",
  );
}

function fmtTime(ms: number) {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <p v-if="!root" class="m-0 text-[12px] text-[var(--color-dim)]">
      公共区会话未绑定目录，指定工作区后可使用 Git。
    </p>
    <template v-else>
      <!-- 头部：视图切换 + 分支 + 刷新 -->
      <div class="flex flex-none items-center gap-1">
        <button type="button" :class="segmentCls(view === 'changes')" @click="view = 'changes'">
          变更
        </button>
        <button type="button" :class="segmentCls(view === 'graph')" @click="view = 'graph'">
          图谱
        </button>
        <span class="ml-auto flex items-center gap-1">
          <span
            class="inline-flex max-w-[110px] items-center gap-1 rounded-full bg-[var(--color-chip-bg)] px-2 py-0.5 text-[11px] text-[var(--color-txt)]"
            :title="status?.branch"
          >
            <GitBranch class="size-3 flex-none" aria-hidden="true" />
            <span class="truncate">{{ status?.branch || "—" }}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="loading ? '刷新中' : '刷新'"
            title="刷新"
            @click="view === 'changes' ? refresh() : refreshGraph()"
          >
            <RefreshCw :class="loading ? 'animate-spin' : ''" />
          </Button>
        </span>
      </div>

      <template v-if="view === 'changes'">
        <!-- 新建分支 -->
        <div v-if="branchCreating" class="flex flex-none items-center gap-1">
          <input
            v-model="branchName"
            placeholder="新分支名称"
            class="h-6 min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
            @keydown.enter="createBranch"
            @keydown.escape="branchCreating = false"
          />
          <Button variant="secondary" size="xs" @click="createBranch">创建</Button>
          <Button variant="ghost" size="xs" @click="branchCreating = false">取消</Button>
        </div>
        <div v-else class="flex flex-none items-center">
          <Button variant="ghost" size="xs" @click="branchCreating = true">
            <GitBranchPlus />
            新建分支
          </Button>
        </div>
        <p v-if="branchError" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
          {{ branchError }}
        </p>

        <!-- 变更列表 -->
        <div class="min-h-0 flex-1 overflow-auto">
          <div class="flex items-center gap-2 px-1 pb-1">
            <input
              id="git-select-all"
              type="checkbox"
              class="size-3 accent-[var(--color-accent)]"
              :checked="allChecked"
              :disabled="!changeList.length"
              @change="toggleAll"
            />
            <label for="git-select-all" class="cursor-pointer text-[11px] text-[var(--color-dim)]">
              全选（{{ checkedPaths.length }}/{{ changeList.length }}）
            </label>
          </div>
          <p v-if="!changeList.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
            {{ loading ? "读取中…" : "没有变更" }}
          </p>
          <button
            v-for="change in changeList"
            :key="change.path"
            type="button"
            :class="rowCls(selectedPath === change.path)"
            @click="selectFile(change.path)"
          >
            <input
              type="checkbox"
              class="size-3 flex-none accent-[var(--color-accent)]"
              :checked="checked.has(change.path)"
              @click.stop
              @change="toggle(change.path)"
            />
            <span :class="cn('w-3 flex-none text-center font-mono text-[11px]', statusBadge(change).cls)">
              {{ statusBadge(change).text }}
            </span>
            <span class="min-w-0 flex-1 truncate">{{ change.path }}</span>
            <span class="flex-none font-[family-name:var(--font-mono)] text-[10.5px]">
              <span class="text-[var(--color-add)]">{{ change.add || "" }}</span>
              <span class="text-[var(--color-del)]">{{ change.del || "" }}</span>
            </span>
          </button>
        </div>

        <!-- diff 折叠区 -->
        <div v-if="selectedPath" class="flex-none">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-0.5 py-0.5 text-left text-[11px] text-[var(--color-dim)] hover:text-[var(--color-mut)]"
            @click="diffOpen = !diffOpen"
          >
            <ChevronDown
              class="size-3"
              :class="diffOpen ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate">{{ selectedPath }}</span>
          </button>
          <pre
            v-if="diffOpen && diff"
            class="m-0 max-h-[30%] overflow-auto rounded-md border border-[var(--color-line-soft)] bg-[var(--color-code-bg)] p-2 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal whitespace-pre-wrap text-[var(--color-code-fg)]"
          >{{ diff }}</pre>
        </div>

        <!-- 提交区 -->
        <div class="flex flex-none flex-col gap-1.5">
          <textarea
            v-model="message"
            rows="2"
            placeholder="提交信息（留空不可提交）"
            class="w-full resize-none rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 py-1.5 text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
          />
          <p v-if="feedback" class="m-0 text-[11px] text-[var(--color-mut)]" role="status">
            {{ feedback }}
          </p>
          <div class="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              :disabled="generating"
              aria-label="AI 生成提交信息"
              @click="generateMessage"
            >
              <Sparkles />
              {{ generating ? "生成中…" : "AI 生成" }}
            </Button>
            <span class="flex-1" aria-hidden="true" />
            <Button
              variant="secondary"
              size="xs"
              :disabled="committing || !message.trim() || !changeList.length"
              @click="submit(false)"
            >
              提交
            </Button>
            <Button
              variant="secondary"
              size="xs"
              :disabled="committing || !message.trim() || !changeList.length"
              @click="submit(true)"
            >
              提交并推送
            </Button>
            <Loader2 v-if="committing" class="size-3 animate-spin text-[var(--color-mut)]" />
          </div>
        </div>
      </template>

      <!-- 图谱 -->
      <div v-else class="min-h-0 flex-1 overflow-auto">
        <p v-if="!log.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
          暂无提交记录
        </p>
        <div
          v-for="(entry, index) in log"
          :key="entry.hash"
          class="relative flex min-h-[40px] gap-2 pl-1.5"
        >
          <span class="relative flex w-3 flex-none justify-center" aria-hidden="true">
            <span
              v-if="index < log.length - 1"
              class="absolute inset-y-0 w-px bg-[var(--color-line-strong)]"
            />
            <span
              class="relative z-10 mt-1.5 size-1.5 rounded-full"
              :class="entry.parents.length > 1 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-mut)]'"
            />
          </span>
          <div class="min-w-0 flex-1 pb-2.5">
            <p class="m-0 truncate text-[12px] text-[var(--color-txt)]">{{ entry.subject }}</p>
            <p class="m-0 truncate text-[10.5px] text-[var(--color-dim)]">
              {{ entry.hash.slice(0, 7) }} · {{ entry.author }} · {{ fmtTime(entry.time) }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
