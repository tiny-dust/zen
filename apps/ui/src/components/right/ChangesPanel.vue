<script setup lang="ts">
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  Ellipsis,
  FolderTree,
  GitMerge,
  List,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Undo2,
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import DangerIconButton from "@/components/base/DangerIconButton.vue";
import FileLabel from "@/components/files/FileLabel.vue";
import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import ChangeTreeRow from "@/components/right/ChangeTreeRow.vue";
import DiffView from "@/components/right/DiffView.vue";
import MergeBranchDialog from "@/components/right/MergeBranchDialog.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

import type { ChangeNode } from "@/components/right/panel-nodes";

type ViewMode = "tree" | "flat";
/** 工具栏远端同步操作进行中状态（组件局部；fetch/pull/push 一次只跑一个） */
type SyncOp = "fetch" | "pull" | "push";

const { t } = useI18n();
const gitStore = useGitStore();
onMounted(() => gitStore.startStatusWatch());
onUnmounted(() => gitStore.stopStatusWatch());
const viewMode = ref<ViewMode>("flat");
const expanded = ref(new Set<string>([""]));

const syncBusy = ref<SyncOp | "">("");
const stashBusy = ref(false);
const abortBusy = ref(false);
const stashOpen = ref(false);
const mergeDialogOpen = ref(false);

/** fetch / pull / push：互斥执行，结果反馈（toast/冲突提示）在 git store 内统一处理 */
async function runSync(op: SyncOp) {
  if (syncBusy.value) {
    return;
  }
  syncBusy.value = op;
  try {
    if (op === "fetch") {
      await gitStore.fetchRemote();
    } else if (op === "pull") {
      await gitStore.pull();
    } else {
      await gitStore.push();
    }
  } finally {
    syncBusy.value = "";
  }
}

/** 贮藏当前变更（默认说明，未跟踪文件一并收入） */
async function stashChanges() {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashPush();
  } finally {
    stashBusy.value = false;
  }
}

/** 弹出最新贮藏（应用并删除 stash@{0}） */
async function popLatestStash() {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashApply(0, "pop");
  } finally {
    stashBusy.value = false;
  }
}

async function applyStash(index: number) {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashApply(index, "apply");
  } finally {
    stashBusy.value = false;
  }
}

async function dropStash(index: number) {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashDrop(index);
  } finally {
    stashBusy.value = false;
  }
}

async function abortMerge() {
  if (abortBusy.value) {
    return;
  }
  abortBusy.value = true;
  try {
    await gitStore.mergeAbort();
  } finally {
    abortBusy.value = false;
  }
}

/** 打开贮藏浮层时刷新列表（远端或终端里可能已变动） */
function onStashOpenChange(open: boolean) {
  stashOpen.value = open;
  if (open) {
    void gitStore.refreshStashes();
  }
}

/** 变更列表/diff 分割比例（%），拖拽手柄调整 */
const splitPct = ref(46);
const SPLIT_MIN = 18;
const SPLIT_MAX = 66;
const containerEl = ref<HTMLElement | null>(null);

function onSplitDrag(delta: number) {
  const total = containerEl.value?.clientWidth ?? 0;
  if (!total) {
    return;
  }
  const next = splitPct.value + (delta / total) * 100;
  splitPct.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next));
}

const files = computed(() => gitStore.files);

/** 合并进行中（MERGE_HEAD 存在）：横幅引导在变更列表解决冲突后提交 */
const merging = computed(() => gitStore.status?.merging ?? false);
/** 未合并（冲突）文件数：porcelain 状态对为 DD/AU/UD/UA/DU/AA/UU */
const conflictCount = computed(
  () =>
    files.value.filter(
      (item) =>
        item.x === "U" ||
        item.y === "U" ||
        (item.x === "D" && item.y === "D") ||
        (item.x === "A" && item.y === "A"),
    ).length,
);

const tree = computed<ChangeNode[]>(() => {
  const root: ChangeNode = { name: "", path: "", isDir: true, children: [] };
  const map = new Map<string, ChangeNode>([["", root]]);
  for (const change of files.value) {
    const parts = change.path.split("/");
    let parent = root;
    let acc = "";
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      if (!name) {
        continue;
      }
      acc = acc ? `${acc}/${name}` : name;
      const isLeaf = i === parts.length - 1;
      let node = map.get(acc);
      if (!node) {
        node = { name, path: acc, isDir: !isLeaf, children: [] };
        map.set(acc, node);
        parent.children.push(node);
      }
      if (isLeaf) {
        node.change = change;
        node.isDir = false;
      }
      parent = node;
    }
  }
  sortNodes(root.children);
  return root.children;
});

function sortNodes(nodes: ChangeNode[]) {
  nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  for (const node of nodes) {
    if (node.children.length) {
      sortNodes(node.children);
    }
  }
}

function toggle(node: ChangeNode) {
  if (!node.isDir) {
    void gitStore.selectFile(node.path);
    return;
  }
  const next = new Set(expanded.value);
  if (next.has(node.path)) {
    next.delete(node.path);
  } else {
    next.add(node.path);
  }
  expanded.value = next;
}

watch(
  () => files.value.length,
  () => {
    if (!gitStore.selectedPath && files.value.length) {
      void gitStore.selectFile(files.value[0].path);
    }
  },
  { immediate: true },
);

const menuItemCls = "min-h-8 gap-2 rounded-lg text-[var(--color-txt)]";
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex flex-none items-center gap-1">
      <span
        class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]"
      >
        {{ t("panels.changedFiles") }}
      </span>
      <span class="flex-none font-[family-name:var(--font-mono)] text-[11px]">
        <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
        <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
      </span>

      <!-- 远端同步：fetch / pull（落后徽标）/ push（领先徽标） -->
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.fetch')"
        :title="t('panels.fetch')"
        :disabled="syncBusy !== ''"
        @click="runSync('fetch')"
      >
        <CloudDownload :class="syncBusy === 'fetch' ? 'animate-spin' : ''" />
      </Button>
      <Button
        variant="ghost"
        class="h-6 w-auto flex-none gap-0.5 rounded-[min(var(--radius-md),10px)] px-1"
        :aria-label="t('panels.pull')"
        :title="gitStore.status?.behind ? t('panels.upstreamDiffTitle') : t('panels.pull')"
        :disabled="syncBusy !== ''"
        @click="runSync('pull')"
      >
        <ArrowDownToLine class="size-3" aria-hidden="true" />
        <span
          v-if="gitStore.status?.behind"
          class="font-[family-name:var(--font-mono)] text-[10px] leading-none text-[var(--color-err)]"
        >
          {{ gitStore.status.behind }}
        </span>
      </Button>
      <Button
        variant="ghost"
        class="h-6 w-auto flex-none gap-0.5 rounded-[min(var(--radius-md),10px)] px-1"
        :aria-label="t('panels.push')"
        :title="gitStore.status?.ahead ? t('panels.upstreamDiffTitle') : t('panels.push')"
        :disabled="syncBusy !== ''"
        @click="runSync('push')"
      >
        <ArrowUpFromLine class="size-3" aria-hidden="true" />
        <span
          v-if="gitStore.status?.ahead"
          class="font-[family-name:var(--font-mono)] text-[10px] leading-none text-[var(--color-add)]"
        >
          {{ gitStore.status.ahead }}
        </span>
      </Button>

      <!-- 贮藏列表浮层：应用 / 删除 -->
      <Popover :open="stashOpen" @update:open="onStashOpenChange">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('panels.stashList')"
            :title="t('panels.stashList')"
          >
            <Archive />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" :side-offset="6" class="w-[280px] gap-1.5 p-2">
          <div class="flex items-center gap-1 px-0.5">
            <span class="flex-1 text-[11px] font-semibold text-[var(--color-txt-strong)]">
              {{ t("panels.stashList") }}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="t('panels.refreshStashList')"
              :title="t('panels.refreshStashList')"
              @click="gitStore.refreshStashes()"
            >
              <RefreshCw :class="gitStore.stashesLoading ? 'animate-spin' : ''" />
            </Button>
          </div>

          <div class="flex max-h-[260px] min-h-0 flex-col overflow-auto">
            <p
              v-if="!gitStore.stashes.length"
              class="m-0 px-1 py-1.5 text-[11px] text-[var(--color-mut)]"
            >
              {{ gitStore.stashesLoading ? t("panels.loading") : t("panels.noStashes") }}
            </p>
            <div
              v-for="stash in gitStore.stashes"
              :key="stash.index"
              class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-[var(--color-menu-hover)]"
            >
              <span
                class="w-6 flex-none text-center font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
              >
                #{{ stash.index }}
              </span>
              <span
                class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]"
                :title="stash.message"
              >
                {{ stash.message }}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="t('panels.applyStash')"
                :title="t('panels.applyStash')"
                :disabled="stashBusy"
                @click="applyStash(stash.index)"
              >
                <ArchiveRestore />
              </Button>
              <DangerIconButton
                :label="t('panels.dropStash')"
                :disabled="stashBusy"
                @click="dropStash(stash.index)"
              >
                <Trash2 />
              </DangerIconButton>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <!-- 更多 Git 操作：合并分支 / 贮藏 / 弹出 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('panels.moreGitActions')"
            :title="t('panels.moreGitActions')"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-[190px]">
          <DropdownMenuItem :class="menuItemCls" @select="mergeDialogOpen = true">
            <GitMerge class="size-[15px] flex-none text-[var(--color-mut)]" />
            <span>{{ t("panels.mergeBranch") }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItemCls" :disabled="stashBusy" @select="stashChanges">
            <Archive class="size-[15px] flex-none text-[var(--color-mut)]" />
            <span>{{ t("panels.stashChanges") }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItemCls" :disabled="stashBusy" @select="popLatestStash">
            <ArchiveRestore class="size-[15px] flex-none text-[var(--color-mut)]" />
            <span>{{ t("panels.popLatestStash") }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="viewMode === 'flat' ? t('panels.switchToTree') : t('panels.switchToFlat')"
        :title="viewMode === 'flat' ? t('panels.tree') : t('panels.flat')"
        @click="viewMode = viewMode === 'flat' ? 'tree' : 'flat'"
      >
        <FolderTree v-if="viewMode === 'flat'" />
        <List v-else />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.refreshChanges')"
        :title="t('panels.refresh')"
        @click="gitStore.refreshStatus()"
      >
        <RefreshCw :class="gitStore.loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <!-- 合并进行中：冲突文件已在下方列表（U 状态），解决后提交或中止 -->
    <div
      v-if="merging"
      class="flex flex-none items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2 py-1.5"
      role="status"
    >
      <TriangleAlert class="size-3.5 flex-none text-[var(--color-err)]" aria-hidden="true" />
      <span class="min-w-0 flex-1 text-[11px] text-[var(--color-txt)]">
        {{
          conflictCount
            ? t("panels.mergeInProgress", { n: conflictCount })
            : t("panels.mergeResolvedPending")
        }}
      </span>
      <Button variant="ghost" size="xs" :disabled="abortBusy" @click="abortMerge">
        <Undo2 class="size-3" aria-hidden="true" />
        {{ t("panels.abortMerge") }}
      </Button>
    </div>

    <div ref="containerEl" class="flex min-h-0 flex-1 gap-0.5">
      <div
        class="flex min-w-[150px] flex-none flex-col overflow-auto"
        :style="{ width: `${splitPct}%` }"
      >
        <p v-if="!files.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
          {{ gitStore.loading ? t("panels.loading") : t("panels.noChanges") }}
        </p>

        <template v-else-if="viewMode === 'flat'">
          <Button
            v-for="change in files"
            :key="change.path"
            variant="ghost"
            :class="
              cn(
                'flex h-auto w-full items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-normal text-[11px] md:text-[11px]',
                gitStore.selectedPath === change.path
                  ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                  : 'text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]',
              )
            "
            @click="gitStore.selectFile(change.path)"
          >
            <span
              :class="
                cn(
                  'w-3 flex-none text-center font-[family-name:var(--font-mono)] text-[10px]',
                  gitStore.statusBadge(change).cls,
                )
              "
            >
              {{ gitStore.statusBadge(change).text }}
            </span>
            <FileLabel :path="change.path" class="flex-1 font-[family-name:var(--font-mono)]" />
            <span
              class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]"
            >
              <span v-if="change.add" class="text-[var(--color-add)]">+{{ change.add }}</span>
              <span v-if="change.del" class="text-[var(--color-del)]">-{{ change.del }}</span>
            </span>
          </Button>
        </template>

        <ChangeTreeRow
          v-else
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :expanded="expanded"
          :selected="gitStore.selectedPath"
          @toggle="toggle"
        />
      </div>

      <ResizeHandle line orientation="vertical" @drag="onSplitDrag" />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div v-if="gitStore.selectedPath" class="flex flex-none items-center gap-1 pb-1">
          <FileLabel
            :path="gitStore.selectedPath"
            class="flex-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
          />
        </div>
        <p
          v-if="!gitStore.selectedPath"
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          {{ t("panels.selectFileForDiff") }}
        </p>
        <p
          v-else-if="gitStore.diffLoading"
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          {{ t("panels.loadingDiff") }}
        </p>
        <DiffView v-else-if="gitStore.diff" :diff="gitStore.diff" />
        <p
          v-else
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          {{ t("panels.noDiffContent") }}
        </p>
      </div>
    </div>

    <!-- 合并分支弹窗（更多菜单触发） -->
    <MergeBranchDialog :open="mergeDialogOpen" @update:open="mergeDialogOpen = $event" />
  </div>
</template>
