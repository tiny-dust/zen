<script setup lang="ts">
import { computed } from "vue";

import FileIcon from "@/components/files/FileIcon.vue";
import { fileBasename } from "@/lib/file-icons";

const props = withDefaults(defineProps<{
  path: string;
  name?: string;
  kind?: "file" | "directory";
  expanded?: boolean;
  variant?: "normal" | "link";
}>(), {
  kind: "file",
  expanded: false,
  variant: "normal",
});

const label = computed(() => props.name ?? fileBasename(props.path));
// A basename label must not discard directory-scoped icon associations.
const iconPath = computed(() => !props.name || props.name === fileBasename(props.path) ? props.path : props.name);
</script>

<template>
  <span class="file-label" :class="{ 'file-label--link': variant === 'link' }" :title="path">
    <FileIcon :path="iconPath" :kind="kind" :expanded="expanded" />
    <span class="file-label__name">{{ label }}</span>
  </span>
</template>
