<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  FolderTree,
  List,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "@lucide/vue";
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

import type { ChangeNode } from "@/components/right/panel-nodes";

/** Git 面板「变更」分区：工作区变更列表 + 远端同步（fetch/pull/push）与合并冲突引导。
 *  点击文件在右侧打开 diff tab（GitPanel 负责 tab 区）；行内支持单文件撤回。 */

type ViewMode = "tree" | "flat";
/** 分区头远端同步操作进行中状态（组件局部；fetch/pull/push 一次只跑一个） */
type SyncOp = "fetch" | "pull" | "push";

const props = defineProps<{ open: boolean }>();
defineEmits<{ toggle: [] }>();

const { t } = useI18n();
const gitStore = useGitStore();
const viewMode = ref<ViewMode>("flat");
const expanded = ref(new Set<string>([""]));

const syncBusy = ref<SyncOp | "">("");
const abortBusy = ref(false);
const discardBusy = ref(false);
/** 撤回确认弹窗：null 关闭；true = 撤回全部，string = 单文件路径 */
const discardTarget = ref<true | string | null>(null);

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

/** 确认后执行撤回（单文件或全部） */
async function confirmDiscard() {
  const target = discardTarget.value;
  if (target == null || discardBusy.value) {
    return;
  }
  discardBusy.value = true;
  try {
    await gitStore.discard(target === true ? undefined : [target]);
    discardTarget.value = null;
  } finally {
    discardBusy.value = false;
  }
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
        :disabled="!files.length || discardBusy"
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

    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <p v-if="!files.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        {{ gitStore.loading ? t("panels.loading") : t("panels.noChanges") }}
      </p>

      <template v-else-if="viewMode === 'flat'">
        <div
          v-for="change in files"
          :key="change.path"
          class="group flex items-center"
        >
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
            @click="gitStore.openFileTab(change.path)"
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
          <DangerIconButton
            class="mr-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 focus-visible:opacity-100"
            :label="t('panels.discardFile')"
            :disabled="discardBusy"
            @click="discardTarget = change.path"
          >
            <Undo2 />
          </DangerIconButton>
        </div>
      </template>

      <template v-else>
        <div
          v-for="node in tree"
          :key="node.path"
          class="contents"
        >
          <ChangeTreeRow
            :node="node"
            :expanded="expanded"
            :selected="gitStore.activeDiffTab"
            @toggle="toggle"
          />
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="discardDialog !== null"
      :title="discardDialog?.title ?? ''"
      :description="discardDialog?.description ?? ''"
      :confirm-label="discardDialog?.confirmLabel ?? ''"
      :pending="discardBusy"
      @update:open="(open: boolean) => !open && (discardTarget = null)"
      @confirm="confirmDiscard"
    />
  </CollapsibleSection>
</template>
