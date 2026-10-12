<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    node: FileTreeNode;
    expanded: Set<string>;
    selected: string;
    /** 内部剪贴板有缓冲时「粘贴」可用（FilePanel 管理） */
    canPaste?: boolean;
    /** 在 Finder/资源管理器中显示（platformInfo 按平台给出文案；缺省走语言包） */
    showInFolderLabel?: string;
  }>(),
  // prop 默认值不可引用 setup 局部变量（编译期 hoist 限制），缺省文案在使用处回退 t()
  { canPaste: false },
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
          {{
            node.isDir
              ? (expanded.has(node.path) ? t("panels.collapse") : t("panels.expand"))
              : t("panels.open")
          }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'reveal', node)">
          {{ showInFolderLabel ?? t("panels.showInFolder") }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="emit('action', 'copy-relative', node)">
          {{ t("panels.copyRelativePath") }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'copy-absolute', node)">
          {{ t("panels.copyAbsolutePath") }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('action', 'copy', node)">{{ t("panels.copy") }}</ContextMenuItem>
        <ContextMenuItem :disabled="!canPaste" @select="emit('action', 'paste', node)">
          {{ t("panels.paste") }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="emit('action', 'rename', node)">{{ t("panels.rename") }}</ContextMenuItem>
        <ContextMenuItem variant="destructive" @select="emit('action', 'delete', node)">
          {{ t("panels.delete") }}
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
