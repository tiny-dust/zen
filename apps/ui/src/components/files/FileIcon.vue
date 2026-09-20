<script setup lang="ts">
import { computed } from "vue";

import { fileIcon, folderIcon } from "@/lib/file-icons";

const props = withDefaults(defineProps<{
  path: string;
  kind?: "file" | "directory";
  expanded?: boolean;
}>(), { kind: "file", expanded: false });

const icon = computed(() => props.kind === "directory"
  ? folderIcon(props.path, props.expanded)
  : fileIcon(props.path));
</script>

<template>
  <img
    :src="icon.src"
    :data-file-icon="icon.id"
    class="file-label__icon"
    alt=""
    aria-hidden="true"
    draggable="false"
    width="16"
    height="16"
  />
</template>
