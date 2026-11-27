<script setup lang="ts">
import { IconAlertTriangle as TriangleAlert, IconArrowBackUp as Undo2, IconArrowDownBar as ArrowDownToLine, IconArrowUpBar as ArrowUpFromLine, IconBinaryTree as FolderTree, IconCheck as Check, IconChevronDown as ChevronDown, IconCloudDownload as CloudDownload, IconList as List, IconMinus as Minus, IconPlus as Plus, IconRefresh as RefreshCw } from "@tabler/icons-vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import CollapsibleSection from "@/components/right/CollapsibleSection.vue";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import FileLabel from "@/components/files/FileLabel.vue";
import ChangeTreeRow from "@/components/right/ChangeTreeRow.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

import type { GitFileChange } from "@zen/shared";
import type { ChangeNode } from "@/components/right/panel-nodes";

/** Git 面板「变更」分区（VS Code Source Control 语义）：
 *  合并冲突 / 已暂存 / 更改 三段分组，逐文件暂存·取消暂存·撤回，整组批量操作；
 *  点击文件在右侧打开对应侧别的 diff tab（GitPanel 负责 tab 区）。 */

type ViewMode = "tree" | "flat";
/** 分区头远端同步操作进行中状态（组件局部；fetch/pull/push 一次只跑一个） */
type SyncOp = "fetch" | "pull" | "push";
type GroupId = "conflicts" | "staged" | "unstaged";

const props = defineProps<{ open: boolean }>();
defineEmits<{ toggle: [] }>();

const { t } = useI18n();
/** git 面板新增文案统一放 git-panel 模块（命名空间 git-panel） */
const gp = (key: string) => t(`git-panel.gitPanel.${key}`);
const gitStore = useGitStore();
const viewMode = ref<ViewMode>("flat");
const expanded = ref(new Set<string>([""]));

const syncBusy = ref<SyncOp | "">("");
const abortBusy = ref(false);
/** 逐文件暂存/取消暂存进行中：期间禁用行内与组内按钮，避免并发 git index 写 */
const fileBusy = ref(false);
/** 撤回确认弹窗：null 关闭；true = 撤回全部，string = 单文件路径 */
const discardTarget = ref<true | string | null>(null);
const groupOpen = ref<Record<GroupId, boolean>>({ conflicts: true, staged: true, unstaged: true });

watch(() => gitStore.cwd(), () => {
  discardTarget.value = null;
}, { flush: "sync" });

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

/** 单文件操作（暂存 / 取消暂存 / 标记解决）：串行执行，关闭 tab 后续跑不受影响 */
async function runFile(action: "stage" | "unstage", path: string) {
  if (fileBusy.value) {
    return;
  }
  fileBusy.value = true;
  try {
    if (action === "stage") {
      await gitStore.stage([path]);
    } else {
      await gitStore.unstage([path]);
    }
  } finally {
    fileBusy.value = false;
  }
}

/** 整组操作：冲突 → 全部标记为解决（git add）；已暂存 → 全部取消暂存；更改 → 全部暂存 */
async function runGroup(id: GroupId) {
  if (fileBusy.value) {
    return;
  }
  fileBusy.value = true;
  try {
    if (id === "conflicts") {
      await gitStore.resolveConflicts();
    } else if (id === "staged") {
      await gitStore.unstageAll();
    } else {
      await gitStore.stageAll();
    }
  } finally {
    fileBusy.value = false;
  }
}

/** 确认后执行撤回（单文件或全部） */
async function confirmDiscard() {
  const target = discardTarget.value;
  if (target == null || fileBusy.value) {
    return;
  }
  fileBusy.value = true;
  try {
    await gitStore.discard(target === true ? undefined : [target]);
    discardTarget.value = null;
  } finally {
    fileBusy.value = false;
  }
}

const files = computed(() => gitStore.files);

/** 合并进行中（MERGE_HEAD 存在）：横幅引导在变更列表解决冲突后提交 */
const merging = computed(() => gitStore.status?.merging ?? false);
const conflictCount = computed(() => gitStore.conflictFiles.length);

/** 三段分组（顺序固定，空组不渲染） */
const groups = computed(() => [
  { id: "conflicts" as const, label: gp("conflictsGroup"), files: gitStore.conflictFiles },
  { id: "staged" as const, label: gp("stagedGroup"), files: gitStore.stagedFiles },
  { id: "unstaged" as const, label: gp("changesGroup"), files: gitStore.unstagedFiles },
]);
const visibleGroups = computed(() => groups.value.filter((group) => group.files.length > 0));

function groupActionLabel(id: GroupId): string {
  if (id === "conflicts") return gp("resolveAll");
  if (id === "staged") return gp("unstageAll");
  return gp("stageAll");
}

function toggleGroup(id: GroupId) {
  groupOpen.value = { ...groupOpen.value, [id]: !groupOpen.value[id] };
}

/** 每个分组独立构建目录树（tree 模式）；flat 模式直接列表 */
function buildTree(changes: GitFileChange[]): ChangeNode[] {
  const root: ChangeNode = { name: "", path: "", isDir: true, children: [] };
  const map = new Map<string, ChangeNode>([["", root]]);
  for (const change of changes) {
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
}

function sortNodes(nodes: ChangeNode[]) {
  nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  for (const node of nodes) {
    if (node.children.length) {
      sortNodes(node.children);
    }
  }
}

const trees = computed<Record<GroupId, ChangeNode[]>>(() => ({
  conflicts: buildTree(gitStore.conflictFiles),
  staged: buildTree(gitStore.stagedFiles),
  unstaged: buildTree(gitStore.unstagedFiles),
}));

function toggle(node: ChangeNode) {
  if (!node.isDir) {
    // 分组内点击：按该文件所属分组决定 diff 侧别
    gitStore.openFileTab(node.path);
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

const discardDialog = computed(() => {
  const target = discardTarget.value;
  if (target === true) {
    return {
      title: t("panels.discardAllTitle"),
      description: t("panels.discardAllDesc"),
      confirmLabel: t("panels.discardAllConfirm"),
    };
  }
  if (typeof target === "string") {
    return {
      title: t("panels.discardFileTitle"),
      description: t("panels.discardFileDesc", { path: target }),
      confirmLabel: t("panels.discardConfirm"),
    };
  }
  return null;
});
</script>

<template>
  <CollapsibleSection
    :title="t('panels.changesSection')"
    :count="files.length || undefined"
    :open="props.open"
    @toggle="$emit('toggle')"
  >
    <template #meta>
      <span class="flex-none font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">
        <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
        <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
      </span>
    </template>
    <template #actions>
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
      <DangerIconButton
        :label="t('panels.discardAll')"
        :disabled="!files.length || fileBusy"
        @click="discardTarget = true"
      >
        <Undo2 />
      </DangerIconButton>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.refreshChanges')"
        :title="t('panels.refresh')"
        @click="gitStore.refreshStatus()"
      >
        <RefreshCw :class="gitStore.loading ? 'animate-spin' : ''" />
      </Button>
    </template>

    <!-- 合并进行中：冲突文件已在「合并冲突」分组（U 状态），解决后提交或中止 -->
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

    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
      <p v-if="!files.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        {{ gitStore.loading ? t("panels.loading") : t("panels.noChanges") }}
      </p>

      <section v-for="group in visibleGroups" :key="group.id" class="flex flex-col">
        <!-- 分组头：折叠 + 计数 + 整组操作（VS Code 视图分节样式） -->
        <header class="flex h-6 min-w-0 flex-none items-center gap-0.5">
          <Button
            variant="ghost"
            class="flex h-6 min-w-0 flex-1 items-center justify-start gap-1 rounded-md px-1 text-left font-normal"
            :aria-expanded="groupOpen[group.id]"
            @click="toggleGroup(group.id)"
          >
            <ChevronDown
              class="size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
              :class="groupOpen[group.id] ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate text-[11px] font-semibold text-[var(--color-txt)]">
              {{ group.label }}
            </span>
            <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
              {{ group.files.length }}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            class="h-6 flex-none px-1 text-[10px] text-[var(--color-mut)]"
            :aria-label="groupActionLabel(group.id)"
            :title="groupActionLabel(group.id)"
            :disabled="fileBusy"
            @click="runGroup(group.id)"
          >
            {{ groupActionLabel(group.id) }}
          </Button>
        </header>

        <div v-show="groupOpen[group.id]" class="flex flex-col">
          <template v-if="viewMode === 'flat'">
            <div v-for="change in group.files" :key="`${group.id}:${change.path}`" class="group flex items-center">
              <Button
                variant="ghost"
                :class="
                  cn(
                    'flex h-auto min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-normal text-[11px] md:text-[11px]',
                    gitStore.activeDiffTab === change.path
                      ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                      : 'text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]',
                  )
                "
                @click="gitStore.openFileTab(change.path, group.id === 'staged' ? 'staged' : 'unstaged')"
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
                <FileLabel :path="change.path" class="min-w-0 flex-1 font-[family-name:var(--font-mono)]" />
                <span
                  class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]"
                >
                  <span v-if="change.add" class="text-[var(--color-add)]">+{{ change.add }}</span>
                  <span v-if="change.del" class="text-[var(--color-del)]">-{{ change.del }}</span>
                </span>
              </Button>
              <!-- 冲突：标记为已解决（git add）；已暂存：取消暂存；更改：暂存 + 撤回 -->
              <Button
                v-if="group.id === 'conflicts'"
                variant="ghost"
                size="icon-xs"
                class="mr-0.5 flex-none opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100"
                :aria-label="gp('resolveFile')"
                :title="gp('resolveFile')"
                :disabled="fileBusy"
                @click="runFile('stage', change.path)"
              >
                <Check />
              </Button>
              <Button
                v-else-if="group.id === 'staged'"
                variant="ghost"
                size="icon-xs"
                class="mr-0.5 flex-none opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100"
                :aria-label="gp('unstageFile')"
                :title="gp('unstageFile')"
                :disabled="fileBusy"
                @click="runFile('unstage', change.path)"
              >
                <Minus />
              </Button>
              <template v-else>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="flex-none opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100"
                  :aria-label="gp('stageFile')"
                  :title="gp('stageFile')"
                  :disabled="fileBusy"
                  @click="runFile('stage', change.path)"
                >
                  <Plus />
                </Button>
                <DangerIconButton
                  class="mr-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100"
                  :label="t('panels.discardFile')"
                  :disabled="fileBusy"
                  @click="discardTarget = change.path"
                >
                  <Undo2 />
                </DangerIconButton>
              </template>
            </div>
          </template>

          <template v-else>
            <div v-for="node in trees[group.id]" :key="`${group.id}:${node.path}`" class="contents">
              <ChangeTreeRow
                :node="node"
                :expanded="expanded"
                :selected="gitStore.activeDiffTab"
                @toggle="toggle"
              />
            </div>
          </template>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="discardDialog !== null"
      :title="discardDialog?.title ?? ''"
      :description="discardDialog?.description ?? ''"
      :confirm-label="discardDialog?.confirmLabel ?? ''"
      :pending="fileBusy"
      @update:open="(open: boolean) => !open && (discardTarget = null)"
      @confirm="confirmDiscard"
    />
  </CollapsibleSection>
</template>
