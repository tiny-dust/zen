<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { cn } from "@/lib/utils";

import type { FileTreeNode } from "@/components/right/panel-nodes";

const props = defineProps<{
  node: FileTreeNode;
  expanded: Set<string>;
  selected: string;
}>();

const emit = defineEmits<{
  toggle: [node: FileTreeNode];
}>();

function pad() {
  return props.node.path.split("/").length * 10 + 4;
}

function active() {
  return !props.node.isDir && props.selected === props.node.path;
}

function isOpen() {
  return props.node.isDir && props.expanded.has(props.node.path);
}

</script>

<template>
  <div>
    <button
      type="button"
      :class="
        cn(
          'flex h-[26px] w-full items-center gap-1 rounded-md pr-1.5 text-left text-[12px]',
          active()
            ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
            : 'text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]',
        )
      "
      :style="{ paddingLeft: `${pad()}px` }"
      @click="emit('toggle', node)"
    >
      <ChevronDown
        v-if="node.isDir && expanded.has(node.path)"
        class="size-3 flex-none text-[var(--color-dim)]"
        aria-hidden="true"
      />
      <ChevronRight
        v-else-if="node.isDir"
        class="size-3 flex-none text-[var(--color-dim)]"
        aria-hidden="true"
      />
      <span v-else class="size-3 flex-none" aria-hidden="true" />
      <FileLabel
        :path="node.path"
        :kind="node.isDir ? 'directory' : 'file'"
        :expanded="isOpen()"
        class="flex-1"
      />
    </button>
    <template v-if="node.isDir && expanded.has(node.path)">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :expanded="expanded"
        :selected="selected"
        @toggle="emit('toggle', $event)"
      />
    </template>
  </div>
</template>

<script lang="ts">
export default { name: "FileTreeNode" };
</script>
