<script setup lang="ts">
import {
  ChevronDown,
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe,
  Link2,
} from "@lucide/vue";
import type { Component } from "vue";
import { computed, reactive, ref } from "vue";

import FilePreviewDialog from "@/components/base/FilePreviewDialog.vue";
import FileLabel from "@/components/files/FileLabel.vue";
import { resolveFileRefPath } from "@/components/files/file-ref";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useSessionRoot } from "@/composables/useSessionRoot";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSessionInfoStore } from "@/stores/session-info";

const sessionInfo = useSessionInfoStore();
const rightPanel = useRightPanelStore();
const sessionRoot = useSessionRoot();
const open = ref(true);
const refs = computed(() => sessionInfo.references);

/** 用户上传文件点击 → 独立文件预览面板（不走右侧文件浏览器） */
const previewPath = ref("");
const previewOpen = ref(false);

function openPreview(path: string) {
  previewPath.value = path;
  previewOpen.value = true;
}

/** 每组独立折叠：用户上传 / 项目文件 / 网络搜索 */
const groupOpen = reactive<Record<string, boolean>>({
  user: true,
  project: true,
  web: true,
});

const groups = computed(() => {
  const items = refs.value;
  return [
    {
      key: "user",
      label: "用户上传",
      icon: FileUp as Component,
      items: items.filter((item) => item.source === "user"),
    },
    {
      key: "project",
      label: "项目文件",
      icon: FolderOpen as Component,
      items: items.filter((item) => item.source === "project"),
    },
    {
      key: "web",
      label: "网络搜索",
      icon: Globe as Component,
      items: items.filter((item) => (item.source ?? "web") === "web"),
    },
  ].filter((group) => group.items.length);
});

function reveal(path: string) {
  rightPanel.revealFile(path);
}

function toggleGroup(key: string) {
  groupOpen[key] = !groupOpen[key];
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
    <div v-if="open" class="mt-1 flex flex-col gap-2 pb-1">
      <!-- 空态文字与节内行文字同列（27px，见 EnvInfoSection noteIndentCls） -->
      <p v-if="!refs.length" class="m-0 pl-[27px] text-[12px] text-[var(--color-dim)]">暂无参考</p>

      <div v-for="group in groups" :key="group.key" class="flex flex-col gap-1">
        <Button
          variant="ghost"
          class="flex h-auto items-center gap-1.5 px-1 text-left text-[11px] font-normal text-[var(--color-dim)] hover:bg-transparent hover:text-[var(--color-mut)] dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-[var(--color-dim)]"
          :aria-expanded="groupOpen[group.key] !== false"
          @click="toggleGroup(group.key)"
        >
          <component :is="group.icon" class="size-3 flex-none" aria-hidden="true" />
          <span class="min-w-0 flex-1">{{ group.label }}</span>
          <span class="tabular-nums">{{ group.items.length }}</span>
          <ChevronDown
            class="size-3 flex-none transition-transform duration-[var(--motion-fast)]"
            :class="groupOpen[group.key] === false ? '-rotate-90' : ''"
            aria-hidden="true"
          />
        </Button>
        <ul
          v-if="groupOpen[group.key] !== false"
          class="m-0 flex list-none flex-col gap-1 p-0"
        >
          <li v-for="item in group.items" :key="item.id" class="flex items-start gap-1.5 pl-1">
            <!-- ml-px：补上非 web 行按钮的 1px 边框，让 Globe 与文件图标同列（15px） -->
            <Globe
              v-if="group.key === 'web'"
              class="ml-px mt-0.5 size-3 flex-none text-[var(--color-mut)]"
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
            <Button
              v-else
              variant="ghost"
              class="h-auto min-w-0 flex-1 justify-start truncate text-left font-[family-name:var(--font-mono)] text-[11px] font-normal hover:bg-transparent hover:text-[var(--color-txt)] dark:hover:bg-transparent"
              :title="group.key === 'user'
                ? '打开文件预览'
                : sessionRoot
                  ? resolveFileRefPath(item.url, sessionRoot)
                  : item.url"
              @click="group.key === 'user' ? openPreview(item.url) : reveal(item.url)"
            >
              <FileLabel
                :path="item.url"
                :name="group.key === 'user' ? item.title || undefined : undefined"
                :root="sessionRoot"
              />
            </Button>
            <span
              v-if="item.agent"
              class="flex-none rounded-full bg-[var(--color-menu-active)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-mut)]"
              :title="`来自 ${item.agent}`"
            >{{ item.agent }}</span>
            <ExternalLink
              v-if="group.key === 'web'"
              class="mt-0.5 size-3 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
          </li>
        </ul>
      </div>
    </div>

    <FilePreviewDialog
      v-model:open="previewOpen"
      :path="previewPath"
    />
  </section>
</template>
