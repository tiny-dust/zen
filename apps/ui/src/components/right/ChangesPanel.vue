<script setup lang="ts">
import { FolderTree, List, RefreshCw } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import ChangeTreeRow from "@/components/right/ChangeTreeRow.vue";
import DiffView from "@/components/right/DiffView.vue";
import GitGraph from "@/components/right/GitGraph.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

import type { ChangeNode } from "@/components/right/panel-nodes";

type ViewMode = "tree" | "flat";
type PanelView = "changes" | "graph";

const gitStore = useGitStore();
const viewMode = ref<ViewMode>("flat");
const view = ref<PanelView>("changes");
const expanded = ref(new Set<string>([""]));

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

// 切到图谱时按需拉取提交历史
watch(view, (next) => {
  if (next === "graph" && !gitStore.log.length) {
    void gitStore.refreshLog();
  }
});

function viewBtn(active: boolean) {
  return cn(
    "h-6 rounded-md px-2 text-[12px]",
    active
      ? "bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]"
      : "text-[var(--color-mut)] hover:text-[var(--color-txt)]",
  );
}

const files = computed(() => gitStore.files);

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
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex flex-none items-center gap-1">
      <button type="button" :class="viewBtn(view === 'changes')" @click="view = 'changes'">
        变更
      </button>
      <button type="button" :class="viewBtn(view === 'graph')" @click="view = 'graph'">
        图谱
      </button>
      <span class="min-w-0 flex-1" />
      <span
        v-if="view === 'changes'"
        class="flex-none font-[family-name:var(--font-mono)] text-[11px]"
      >
        <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
        <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
      </span>
      <Button
        v-if="view === 'changes'"
        variant="ghost"
        size="icon-xs"
        :aria-label="viewMode === 'flat' ? '切换目录树' : '切换平铺'"
        :title="viewMode === 'flat' ? '目录树' : '平铺'"
        @click="viewMode = viewMode === 'flat' ? 'tree' : 'flat'"
      >
        <FolderTree v-if="viewMode === 'flat'" />
        <List v-else />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="view === 'graph' ? '刷新提交历史' : '刷新变更'"
        title="刷新"
        @click="view === 'graph' ? gitStore.refreshLog() : gitStore.refreshStatus()"
      >
        <RefreshCw :class="gitStore.loading || gitStore.logLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <!-- 图谱：泳道提交历史 -->
    <template v-if="view === 'graph'">
      <p
        v-if="gitStore.logLoading && !gitStore.log.length"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
      >
        读取中…
      </p>
      <p v-else-if="!gitStore.log.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        暂无提交记录
      </p>
      <GitGraph v-else />
    </template>

    <div v-else ref="containerEl" class="flex min-h-0 flex-1 gap-0.5">
      <div
        class="flex min-w-[150px] flex-none flex-col overflow-auto"
        :style="{ width: `${splitPct}%` }"
      >
        <p v-if="!files.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
          {{ gitStore.loading ? "读取中…" : "没有变更" }}
        </p>

        <template v-else-if="viewMode === 'flat'">
          <button
            v-for="change in files"
            :key="change.path"
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11.5px]',
                gitStore.selectedPath === change.path
                  ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                  : 'text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]',
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
            <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)]">
              {{ change.path }}
            </span>
            <span
              class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]"
            >
              <span v-if="change.add" class="text-[var(--color-add)]">+{{ change.add }}</span>
              <span v-if="change.del" class="text-[var(--color-del)]">-{{ change.del }}</span>
            </span>
          </button>
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
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
          >
            {{ gitStore.selectedPath }}
          </span>
        </div>
        <p
          v-if="!gitStore.selectedPath"
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          选择文件查看 diff
        </p>
        <p
          v-else-if="gitStore.diffLoading"
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          读取 diff…
        </p>
        <DiffView v-else-if="gitStore.diff" :diff="gitStore.diff" />
        <p
          v-else
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          无变更内容
        </p>
      </div>
    </div>
  </div>
</template>
