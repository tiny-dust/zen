<script setup lang="ts">
import { FileCode, RefreshCw } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import FileTreeNode from "@/components/right/FileTreeNode.vue";
import FileViewer from "@/components/right/FileViewer.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { WorkspaceFile } from "@zen/shared";
import type { FileTreeNode as FileNode } from "@/components/right/panel-nodes";

const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const files = ref<WorkspaceFile[]>([]);
const loading = ref(false);
const selected = ref("");
const expanded = ref(new Set<string>([""]));
const query = ref("");

/** 树/预览分割比例（%），拖拽手柄调整；预览列保底约 1/3 */
const splitPct = ref(42);
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

const treeRoot = computed(() => workspaceStore.pathOf(chatStore.sessionWorkspaceId));
const fileCount = computed(() => files.value.filter((item) => !item.isDir).length);

const tree = computed<FileNode[]>(() => {
  const root: FileNode = { name: "", path: "", isDir: true, children: [] };
  const map = new Map<string, FileNode>([["", root]]);
  const q = query.value.trim().toLowerCase();
  const source = q
    ? files.value.filter((item) => !item.isDir && item.path.toLowerCase().includes(q))
    : files.value;

  for (const file of source) {
    const parts = file.path.split("/");
    let parent = root;
    let acc = "";
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      if (!name) {
        continue;
      }
      acc = acc ? `${acc}/${name}` : name;
      const isLeafFile = i === parts.length - 1 && !file.isDir;
      let node = map.get(acc);
      if (!node) {
        node = { name, path: acc, isDir: !isLeafFile, children: [] };
        map.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }
  sortNodes(root.children);
  return root.children;
});

function sortNodes(nodes: FileNode[]) {
  nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  for (const node of nodes) {
    if (node.children.length) {
      sortNodes(node.children);
    }
  }
}

async function load() {
  const zen = window.zen;
  const root = treeRoot.value;
  if (!zen || !root) {
    files.value = [];
    return;
  }
  loading.value = true;
  try {
    files.value = await zen.workspace.listFiles(root);
  } finally {
    loading.value = false;
  }
}

function toggle(node: FileNode) {
  if (!node.isDir) {
    selected.value = node.path;
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
  () => treeRoot.value,
  () => {
    selected.value = "";
    expanded.value = new Set([""]);
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div ref="containerEl" class="flex min-h-0 flex-1 gap-0.5">
    <div
      class="flex min-w-[140px] flex-none flex-col gap-1.5"
      :style="{ width: `${splitPct}%` }"
    >
      <div class="flex flex-none items-center gap-1">
        <span
          class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]"
        >
          工作区文件
        </span>
        <span class="flex-none text-[10.5px] text-[var(--color-dim)]">{{ fileCount }}</span>
        <Button variant="ghost" size="icon-xs" aria-label="刷新文件列表" title="刷新" @click="load">
          <RefreshCw :class="loading ? 'animate-spin' : ''" />
        </Button>
      </div>
      <input
        v-model="query"
        placeholder="筛选文件"
        class="h-7 w-full flex-none rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
      />
      <p v-if="!treeRoot" class="m-0 px-1 text-[12px] text-[var(--color-dim)]">公共区未绑定目录</p>
      <p v-else-if="loading && !files.length" class="m-0 px-1 text-[12px] text-[var(--color-dim)]">
        读取中…
      </p>
      <p v-else-if="!tree.length" class="m-0 px-1 text-[12px] text-[var(--color-dim)]">
        {{ query ? "无匹配文件" : "空目录" }}
      </p>
      <div v-else class="min-h-0 flex-1 overflow-auto">
        <FileTreeNode
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :expanded="expanded"
          :selected="selected"
          @toggle="toggle"
        />
      </div>
    </div>

    <ResizeHandle line orientation="vertical" @drag="onSplitDrag" />

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div v-if="selected" class="flex flex-none items-center gap-1 pb-1">
        <span
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        >
          {{ selected }}
        </span>
      </div>
      <div
        v-if="!selected"
        class="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-dim)]"
      >
        <FileCode class="size-5" aria-hidden="true" />
        <p class="m-0 text-[12px]">在左侧选择文件预览</p>
      </div>
      <FileViewer
        v-else
        :key="`viewer-${treeRoot}-${selected}`"
        :path="selected"
        :root="treeRoot"
      />
    </div>
  </div>
</template>
