<script setup lang="ts">
import {
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe,
  Link2,
} from "@lucide/vue";
import type { Component } from "vue";
import { computed, ref } from "vue";

import FileLabel from "@/components/files/FileLabel.vue";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { openAppLink } from "@/lib/browser-element";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSessionInfoStore } from "@/stores/session-info";

const sessionInfo = useSessionInfoStore();
const rightPanel = useRightPanelStore();
const open = ref(true);
const refs = computed(() => sessionInfo.references);

/** 参考 按「用户上传 / 项目文件 / 网络」分组，空组不显示 */
const groups = computed(() => {
  const items = refs.value;
  return [
    { key: "user", label: "用户", icon: FileUp as Component, items: items.filter((item) => item.source === "user") },
    {
      key: "project",
      label: "项目",
      icon: FolderOpen as Component,
      items: items.filter((item) => item.source === "project"),
    },
    {
      key: "web",
      label: "网络",
      icon: Globe as Component,
      items: items.filter((item) => (item.source ?? "web") === "web"),
    },
  ].filter((group) => group.items.length);
});

/** 本地文件参考：点击在右侧文件面板定位 */
function reveal(path: string) {
  rightPanel.revealFile(path);
}
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="Link2"
      title="参考"
      :open="open"
      :count="refs.length ? String(refs.length) : undefined"
      @toggle="open = !open"
    />
    <div v-if="open" class="mt-1 flex flex-col gap-2.5 pb-1">
      <p v-if="!refs.length" class="m-0 px-1 text-[12px] text-[var(--color-dim)]">暂无参考</p>

      <div v-for="group in groups" :key="group.key" class="flex flex-col gap-1">
        <p class="m-0 flex items-center gap-1 px-1 text-[11px] text-[var(--color-dim)]">
          <component :is="group.icon" class="size-3 flex-none" aria-hidden="true" />
          {{ group.label }}
          <span class="tabular-nums">{{ group.items.length }}</span>
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li v-for="item in group.items" :key="item.id" class="flex items-start gap-1.5">
            <Globe
              v-if="group.key === 'web'"
              class="mt-0.5 size-3 flex-none text-[var(--color-mut)]"
              aria-hidden="true"
            />
            <a
              v-if="group.key === 'web'"
              :href="item.url"
              target="_blank"
              rel="noreferrer"
              class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt)]"
              :title="item.url"
              @click.stop
            >
              {{ item.title || item.url }}
            </a>
            <button
              v-else
              type="button"
              class="min-w-0 flex-1 truncate text-left font-[family-name:var(--font-mono)] text-[11px] hover:text-[var(--color-txt)]"
              @click="reveal(item.url)"
            >
              <FileLabel :path="item.url" :name="group.key === 'user' ? item.title || undefined : undefined" />
            </button>
            <ExternalLink
              v-if="group.key === 'web'"
              class="mt-0.5 size-3 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
