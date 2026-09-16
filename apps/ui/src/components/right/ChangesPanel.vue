<script setup lang="ts">
import { FolderTree, List, RefreshCw } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import ChangeTreeRow from "@/components/right/ChangeTreeRow.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

import type { ChangeNode } from "@/components/right/panel-nodes";

type ViewMode = "tree" | "flat";

const gitStore = useGitStore();
const viewMode = ref<ViewMode>("flat");
const expanded = ref(new Set<string>([""]));

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
      <span
        class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]"
      >
        变更文件
      </span>
      <span class="flex-none font-[family-name:var(--font-mono)] text-[11px]">
        <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
        <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
      </span>
      <Button
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
        aria-label="刷新变更"
        title="刷新"
        @click="gitStore.refreshStatus()"
      >
        <RefreshCw :class="gitStore.loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <div class="flex min-h-0 flex-1 gap-2">
      <div class="flex w-[46%] min-w-[150px] flex-none flex-col overflow-auto">
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
            <span class="flex-none font-[family-name:var(--font-mono)] text-[10px]">
              <span class="text-[var(--color-add)]">{{ change.add || "" }}</span>
              <span class="text-[var(--color-del)]">{{ change.del || "" }}</span>
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

      <div class="w-px flex-none bg-[var(--color-line)]" aria-hidden="true" />

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
        <pre
          v-else-if="gitStore.diff"
          class="m-0 min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-line-soft)] bg-[var(--color-code-bg)] p-2 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal whitespace-pre-wrap text-[var(--color-code-fg)]"
        >{{ gitStore.diff }}</pre>
        <p
          v-else
          class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
        >
          读取 diff…
        </p>
      </div>
    </div>
  </div>
</template>
