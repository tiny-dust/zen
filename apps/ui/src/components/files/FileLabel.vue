<script setup lang="ts">
import { computed, ref } from "vue";

import FileContextMenu from "@/components/files/FileContextMenu.vue";
import FileIcon from "@/components/files/FileIcon.vue";
import { resolveFileRefPath } from "@/components/files/file-ref";
import { fileBasename } from "@/lib/file-icons";

const props = withDefaults(defineProps<{
  path: string;
  name?: string;
  kind?: "file" | "directory";
  expanded?: boolean;
  /** 可交互文件引用（消息流 chip）：右键弹出文件菜单，点击由宿主处理 */
  variant?: "normal" | "link";
  /** 工作区根：悬浮 title 相对路径绝对化用；缺省按原路径展示 */
  root?: string;
}>(), {
  kind: "file",
  expanded: false,
  variant: "normal",
  root: "",
});

const label = computed(() => props.name ?? fileBasename(props.path));
// A basename label must not discard directory-scoped icon associations.
const iconPath = computed(() => !props.name || props.name === fileBasename(props.path) ? props.path : props.name);
// 悬浮展示完整路径：相对引用按工作区根绝对化，绝对引用保持原样
const titleText = computed(() => (props.root ? resolveFileRefPath(props.path, props.root) : props.path));

const menu = ref<{ x: number; y: number } | null>(null);

function onContextMenu(event: MouseEvent) {
  if (props.variant !== "link" || !props.path) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  menu.value = { x: event.clientX, y: event.clientY };
}
</script>

<template>
  <span
    class="file-label"
    :class="{ 'file-label--link': variant === 'link' }"
    :title="titleText"
    @contextmenu="onContextMenu"
  >
    <FileIcon :path="iconPath" :kind="kind" :expanded="expanded" />
    <span class="file-label__name">{{ label }}</span>
    <FileContextMenu
      v-if="menu"
      :path="path"
      :kind="kind"
      :x="menu.x"
      :y="menu.y"
      @close="menu = null"
    />
  </span>
</template>
