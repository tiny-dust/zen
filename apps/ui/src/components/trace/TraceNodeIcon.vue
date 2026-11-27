<script setup lang="ts">
import {
  IconAlertCircle as CircleAlert,
  IconBrain as Brain,
  IconSparkles as Sparkles,
  IconUser as UserIcon,
} from "@tabler/icons-vue";
import { computed } from "vue";

import { toolDisplay } from "@/components/chat/tool-part";

import type { TraceNode } from "@/lib/trace/document";

/** 轨迹节点图标：工具沿用消息流里的工具图标，其余按节点类型取 */
const props = withDefaults(defineProps<{ node: TraceNode; size?: number }>(), { size: 14 });

const icon = computed(() => {
  const node = props.node;
  if (node.kind === "tool") {
    return toolDisplay(node.call?.name ?? "", node.call?.args).icon;
  }
  if (node.kind === "thinking") {
    return Brain;
  }
  if (node.kind === "reply") {
    return Sparkles;
  }
  if (node.kind === "error") {
    return CircleAlert;
  }
  return UserIcon;
});
</script>

<template>
  <component :is="icon" :size="props.size" :stroke-width="1.75" aria-hidden="true" />
</template>
