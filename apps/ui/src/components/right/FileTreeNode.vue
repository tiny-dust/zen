<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import type { FileTreeNode } from "@/components/right/panel-nodes";
import type { FileTreeAction } from "./file-tree-ops";

const props = withDefaults(
  defineProps<{
    node: FileTreeNode;
    expanded: Set<string>;
    selected: string;
    /** 内部剪贴板有缓冲时「粘贴」可用（FilePanel 管理） */
    canPaste?: boolean;
    /** 在 Finder/资源管理器中显示（platformInfo 按平台给出文案） */
    showInFolderLabel?: string;
  }>(),
  { canPaste: false, showInFolderLabel: "在文件管理器中显示" },
);

const emit = defineEmits<{
  toggle: [node: FileTreeNode];
  action: [action: FileTreeAction, node: FileTreeNode];
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
  <!-- stop：右键冒泡到树容器的空白区菜单触发器 -->
  <div @contextmenu.stop>
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <Button
          variant="ghost"
          :class="
            cn(
              'flex h-[26px] w-full items-center justify-start gap-1 rounded-md pr-1.5 text-left font-normal text-[12px] md:text-[12px]',
              active()
                ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                : 'text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)] dark:hover:bg-[var(--color-side-hover)]',
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
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent class="min-w-44">
        <ContextMenuItem @select="emit('action', 'open', node)">
          {{ node.isDir ? (expanded.has(node.path) ? "折叠" : "展开") : "打开" }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'reveal', node)">
          {{ showInFolderLabel }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="emit('action', 'copy-relative', node)">复制相对路径</ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'copy-absolute', node)">复制绝对路径</ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'copy', node)">复制</ContextMenuItem>
        <ContextMenuItem :disabled="!canPaste" @select="emit('action', 'paste', node)">
          粘贴
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="emit('action', 'rename', node)">重命名</ContextMenuItem>
        <ContextMenuItem variant="destructive" @select="emit('action', 'delete', node)">
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <template v-if="node.isDir && expanded.has(node.path)">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :expanded="expanded"
        :selected="selected"
        :can-paste="canPaste"
        :show-in-folder-label="showInFolderLabel"
        @toggle="emit('toggle', $event)"
        @action="(action, node) => emit('action', action, node)"
      />
    </template>
  </div>
</template>

<script lang="ts">
export default { name: "FileTreeNode" };
</script>
