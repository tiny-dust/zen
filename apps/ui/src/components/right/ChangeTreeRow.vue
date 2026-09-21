<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

import type { ChangeNode } from "@/components/right/panel-nodes";

const props = defineProps<{
  node: ChangeNode;
  expanded: Set<string>;
  selected: string;
}>();

const emit = defineEmits<{
  toggle: [node: ChangeNode];
}>();

const gitStore = useGitStore();

function pad() {
  return props.node.path.split("/").length * 8 + 4;
}

function active() {
  return !props.node.isDir && props.selected === props.node.path;
}
</script>

<template>
  <div>
    <Button
      variant="ghost"
      :class="
        cn(
          'flex h-auto w-full items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-normal text-[11.5px] md:text-[11.5px]',
          active()
            ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]'
            : 'text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]',
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
      <span
        v-else-if="node.change"
        :class="
          cn(
            'w-3 flex-none text-center font-[family-name:var(--font-mono)] text-[10px]',
            gitStore.statusBadge(node.change).cls,
          )
        "
      >
        {{ gitStore.statusBadge(node.change).text }}
      </span>
      <span v-else class="w-3 flex-none" aria-hidden="true" />
      <FileLabel
        :path="node.path"
        :kind="node.isDir ? 'directory' : 'file'"
        :expanded="expanded.has(node.path)"
        class="min-w-0 flex-1"
      />
      <span
        v-if="node.change"
        class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]"
      >
        <span v-if="node.change.add" class="text-[var(--color-add)]">+{{ node.change.add }}</span>
        <span v-if="node.change.del" class="text-[var(--color-del)]">-{{ node.change.del }}</span>
      </span>
    </Button>
    <template v-if="node.isDir && expanded.has(node.path)">
      <ChangeTreeRow
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
export default { name: "ChangeTreeRow" };
</script>
