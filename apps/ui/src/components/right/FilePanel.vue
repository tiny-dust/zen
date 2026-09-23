<script setup lang="ts">
import { FileCode, FolderOpen, RefreshCw, Save } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import FileLabel from "@/components/files/FileLabel.vue";
import {
  isAbsolutePathLike,
  splitLineAnchor,
  toPosixPath,
  toWorkspaceRelativePath,
} from "@/components/files/file-ref";
import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import FileTreeNode from "@/components/right/FileTreeNode.vue";
import FileViewer from "@/components/right/FileViewer.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { classifyPathRef } from "@/lib/path-ref";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useRightPanelStore } from "@/stores/right-panel";
import { useWorkspaceStore } from "@/stores/workspace";

import type { WorkspaceFile } from "@zen/shared";
import type { FileTreeNode as FileNode } from "@/components/right/panel-nodes";

const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const rightPanel = useRightPanelStore();
const files = ref<WorkspaceFile[]>([]);
const loading = ref(false);
const selected = ref("");
/** 消息流行号锚点（:12 / #L12）拆出的定位行 */
const selectedLine = ref<number | undefined>(undefined);
const expanded = ref(new Set<string>([""]));
const query = ref("");
const viewerRef = ref<InstanceType<typeof FileViewer> | null>(null);
const viewerDirty = ref(false);
const viewerSaving = ref(false);

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

/** 引用是否指向目录：文件清单优先，未加载时按引用形态兜底 */
function isDirPath(rel: string): boolean {
  if (!rel) {
    return true;
  }
  if (files.value.some((item) => item.isDir && item.path === rel)) {
    return true;
  }
  if (files.value.some((item) => item.path.startsWith(`${rel}/`))) {
    return true;
  }
  if (files.value.some((item) => !item.isDir && item.path === rel)) {
    return false;
  }
  return classifyPathRef(rel) === "dir" || rel.endsWith("/");
}

const selectedIsDir = computed(() => !!selected.value && isDirPath(selected.value));

function toggle(node: FileNode) {
  if (!node.isDir) {
    selected.value = node.path;
    selectedLine.value = undefined;
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
    selectedLine.value = undefined;
    expanded.value = new Set([""]);
    void load();
  },
  { immediate: true },
);

/** Agent 写文件后自动刷新树与当前预览（本地有未保存修改时不覆盖） */
watch(
  () => chatStore.filesRevision,
  () => {
    void load();
    if (!viewerDirty.value) {
      viewerRef.value?.render();
    }
  },
);

function onViewerDirty(dirty: boolean) {
  viewerDirty.value = dirty;
  if (!dirty) {
    viewerSaving.value = false;
  }
}

async function saveViewer() {
  viewerSaving.value = true;
  const ok = await viewerRef.value?.save();
  viewerSaving.value = false;
  if (ok) {
    viewerDirty.value = false;
    void useGitStore().refreshStatus();
  }
}

function revertViewer() {
  viewerRef.value?.revert();
  viewerDirty.value = false;
}

// 消息流点击文件名 → 展开祖先目录并打开该文件；目录引用就地展开不进编辑器
watch(
  () => rightPanel.pendingReveal,
  (raw) => {
    if (!raw) {
      return;
    }
    rightPanel.pendingReveal = "";
    const { file, line } = splitLineAnchor(raw);
    let rel = toPosixPath(file);
    if (rel === ".") {
      rel = "";
    }
    if (isAbsolutePathLike(rel)) {
      // 工作区内绝对路径折算成树内相对路径；工作区外保留绝对路径走预览回退
      rel = toWorkspaceRelativePath(rel, treeRoot.value) ?? rel;
    }
    if (!isAbsolutePathLike(rel)) {
      const segments = rel.split("/").filter(Boolean);
      const dirSegments = isDirPath(rel) ? segments : segments.slice(0, -1);
      const next = new Set(expanded.value);
      let acc = "";
      for (const segment of dirSegments) {
        acc = acc ? `${acc}/${segment}` : segment;
        next.add(acc);
      }
      expanded.value = next;
    }
    selectedLine.value = line;
    selected.value = rel;
    if (!files.value.length) {
      void load();
    }
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
      <Input
        v-model="query"
        variant="ghost"
        class="h-7 w-full flex-none rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 text-[12px] md:text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
        placeholder="筛选文件"
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
        <FileLabel
          :path="selected"
          class="flex-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        />
        <template v-if="viewerDirty">
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-1.5 text-[11px]"
            :disabled="viewerSaving"
            @click="revertViewer"
          >
            放弃
          </Button>
          <Button
            size="sm"
            class="h-6 px-1.5 text-[11px]"
            :disabled="viewerSaving"
            @click="saveViewer"
          >
            <Save :size="12" data-icon="inline-start" />保存
          </Button>
        </template>
      </div>
      <div
        v-if="!selected"
        class="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-dim)]"
      >
        <FileCode class="size-5" aria-hidden="true" />
        <p class="m-0 text-[12px]">在左侧选择文件，可直接编辑保存</p>
      </div>
      <div
        v-else-if="selectedIsDir"
        class="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-dim)]"
      >
        <FolderOpen class="size-5" aria-hidden="true" />
        <p class="m-0 max-w-full truncate px-2 text-[12px]">目录：{{ selected }}</p>
      </div>
      <FileViewer
        v-else
        :key="`viewer-${treeRoot}-${selected}`"
        ref="viewerRef"
        :path="selected"
        :root="treeRoot"
        :line="selectedLine"
        @dirty-change="onViewerDirty"
        @saved="onViewerDirty(false)"
      />
    </div>
  </div>
</template>
