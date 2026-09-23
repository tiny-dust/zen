<script setup lang="ts">
import { computed, ref } from "vue";

import FileContextMenu from "@/components/files/FileContextMenu.vue";
import FileIcon from "@/components/files/FileIcon.vue";
import { fileBasename } from "@/lib/file-icons";

const props = withDefaults(defineProps<{
  path: string;
  name?: string;
  kind?: "file" | "directory";
  expanded?: boolean;
  /** 可交互文件引用（消息流 chip）：右键弹出文件菜单，点击由宿主处理 */
  variant?: "normal" | "link";
}>(), {
  kind: "file",
  expanded: false,
  variant: "normal",
});

const label = computed(() => props.name ?? fileBasename(props.path));
// A basename label must not discard directory-scoped icon associations.
const iconPath = computed(() => !props.name || props.name === fileBasename(props.path) ? props.path : props.name);

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
    :title="path"
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
