<script setup lang="ts">
import { nextTick, ref } from "vue";
import { classes } from "rattail";

import CommitPanel from "@/components/session/CommitPanel.vue";
import EnvInfoSection from "@/components/session/EnvInfoSection.vue";
import ReferencesSection from "@/components/session/ReferencesSection.vue";
import TaskListSection from "@/components/session/TaskListSection.vue";
import { useGitStore } from "@/stores/git";

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const gitStore = useGitStore();
const rootEl = ref<HTMLElement | null>(null);
const commitPos = ref({ top: 0, left: 0 });

const cardCls = classes(
  "flex min-h-0 flex-1 flex-col gap-4",
  "rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-raise)] p-3",
);

/** 节间分隔：细线 + 上方留白，三节边界清晰 */
const dividerCls = "border-t border-[var(--color-line-soft)] pt-4";

/** 提交面板贴在信息卡左侧，与触发行大致齐平 */
async function openCommitPanel() {
  await nextTick();
  const rect = rootEl.value?.getBoundingClientRect();
  if (rect) {
    const width = 228;
    const left = Math.max(8, rect.left - width - 10);
    const top = Math.min(
      Math.max(8, rect.top + 120),
      Math.max(8, window.innerHeight - 320),
    );
    commitPos.value = { top, left };
  }
  gitStore.commitPanelOpen = true;
}
</script>

<template>
  <aside
    ref="rootEl"
    :class="
      embedded
        ? 'flex min-w-0 flex-col bg-transparent'
        : 'flex h-full min-w-0 flex-col overflow-hidden bg-transparent p-2'
    "
    aria-label="会话信息"
  >
    <div :class="embedded ? 'flex flex-col gap-4' : cardCls">
      <EnvInfoSection @open-commit="openCommitPanel" />
      <TaskListSection :class="dividerCls" />
      <ReferencesSection :class="dividerCls" />
    </div>
  </aside>

  <Teleport to="body">
    <div
      v-if="gitStore.commitPanelOpen"
      class="pointer-events-none fixed inset-0 z-[var(--z-popup)]"
    >
      <button
        type="button"
        class="pointer-events-auto absolute inset-0 cursor-default"
        aria-label="关闭提交面板"
        @click="gitStore.commitPanelOpen = false"
      />
      <div
        class="pointer-events-auto absolute"
        :style="{ top: `${commitPos.top}px`, left: `${commitPos.left}px` }"
      >
        <CommitPanel @close="gitStore.commitPanelOpen = false" />
      </div>
    </div>
  </Teleport>
</template>
