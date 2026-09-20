<script setup lang="ts">
import { computed } from "vue";

import { legacyToolPart } from "@/components/chat/message-groups";
import ToolCallRow from "@/components/chat/ToolCallRow.vue";

import type { ToolCallMessageMeta } from "@zen/shared";

const props = defineProps<{ meta: ToolCallMessageMeta; content?: string }>();
const part = computed(() => legacyToolPart(props.meta, "legacy-tool", props.content));
</script>

<template>
  <ToolCallRow :part="part" />
</template>
