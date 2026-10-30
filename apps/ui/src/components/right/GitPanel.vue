<script setup lang="ts">
import { GitGraph as GitGraphIcon, X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import GitBranchesSection from "@/components/right/GitBranchesSection.vue";
import GitChangesSection from "@/components/right/GitChangesSection.vue";
import GitCommitsSection from "@/components/right/GitCommitsSection.vue";
import GitStashesSection from "@/components/right/GitStashesSection.vue";
import DiffView from "@/components/right/DiffView.vue";
import FileLabel from "@/components/files/FileLabel.vue";
import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/composables/useMediaQuery";
import GitRepositoryPicker from "@/components/git/GitRepositoryPicker.vue";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import { cn } from "@/lib/utils";

/**
 * 右侧 Git 面板（VS Code 式布局）：
 * - 左侧窄栏：变更 / 分支 / 贮藏 三个可折叠分区（展开态本组件持有，数据按需加载）
 * - 右侧 tab 区：「图谱」固定 tab（不可关闭）+ 点击变更文件追加的文件 diff tab（可关多个）
 * 左栏宽度可拖拽调整。
 */

type SectionId = "changes" | "branches" | "stashes";

const gitStore = useGitStore();
const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const isWide = useMediaQuery("(min-width: 1100px)");
const showRepositoryPicker = computed(() => !isWide.value || !layoutStore.sessionOpen);
const { t } = useI18n();

function addReviewComment(feedback: { path: string; line: number; side: "old" | "new"; text: string }) {
  const location = `${feedback.path}:${feedback.line}`;
  const side = t(feedback.side === "old" ? "panels.reviewOldSide" : "panels.reviewNewSide");
  chatStore.insertAtComposerCaret(
    t("panels.reviewFeedbackPrompt", { location, text: feedback.text, side }),
  );
}

/** 默认只展开变更分区；其余分区首次展开时再取数 */
const openSections = ref(new Set<SectionId>(["changes"]));

function toggleSection(id: SectionId) {
  const next = new Set(openSections.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  openSections.value = next;
}

/** 左栏宽度（px），拖拽手柄调整 */
const sidebarWidth = ref(230);
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 420;

function onSidebarDrag(delta: number) {
  const next = sidebarWidth.value + delta;
  sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
}

onMounted(() => {
  gitStore.startStatusWatch();
  // 图谱 tab 常驻可见，历史与分支随面板打开即加载
  void gitStore.refreshLog();
  void gitStore.refreshBranches();
});
onUnmounted(() => gitStore.stopStatusWatch());

/** 分区首次展开 / 工作区切换后按需刷新数据源 */
function refreshOpenSections() {
  if (openSections.value.has("branches")) {
    void gitStore.refreshBranches();
  }
  if (openSections.value.has("stashes")) {
    void gitStore.refreshStashes();
  }
}

watch(openSections, refreshOpenSections);
watch(() => gitStore.cwd(), refreshOpenSections);

function tabLabel(path: string): string {
  return path.split("/").pop() ?? path;
}

function tabCls(id: string) {
  return cn(
    "flex h-7 max-w-[150px] flex-none items-center gap-1 rounded-[6px] px-2 text-left text-[12px]",
    gitStore.activeDiffTab === id
      ? "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"
      : "text-[var(--color-mut)] hover:text-[var(--color-txt)]",
  );
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1">
    <GitRepositoryPicker v-if="showRepositoryPicker" class="flex-none px-1" />
    <div class="flex min-h-0 flex-1 gap-0.5">
      <!-- 左侧：变更 / 分支 / 贮藏 分区栏 -->
      <aside
        class="flex min-h-0 flex-none flex-col gap-1 overflow-hidden"
        :style="{ width: `${sidebarWidth}px` }"
      >
        <GitChangesSection :open="openSections.has('changes')" @toggle="toggleSection('changes')" />
        <GitBranchesSection :open="openSections.has('branches')" @toggle="toggleSection('branches')" />
        <GitStashesSection :open="openSections.has('stashes')" @toggle="toggleSection('stashes')" />
      </aside>

      <ResizeHandle line orientation="vertical" @drag="onSidebarDrag" />

      <!-- 右侧：图谱固定 tab + 文件 diff 多 tab -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 flex-none items-center gap-0.5 overflow-x-auto" role="tablist">
          <!-- 图谱 tab：固定，不可关闭 -->
          <div
            :class="tabCls('graph')"
            role="tab"
            :aria-selected="gitStore.activeDiffTab === 'graph'"
            @click="gitStore.activeDiffTab = 'graph'"
          >
            <GitGraphIcon class="size-3.5 flex-none" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ t("panels.graphTab") }}</span>
          </div>
          <div
            v-for="path in gitStore.diffTabs"
            :key="path"
            :class="tabCls(path)"
            role="tab"
            :aria-selected="gitStore.activeDiffTab === path"
            :title="path"
            @click="gitStore.openFileTab(path)"
          >
            <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ tabLabel(path) }}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="ml-0.5 size-4 flex-none rounded text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="t('panels.closeDiffTab')"
              @click.stop="gitStore.closeDiffTab(path)"
            >
              <X class="size-3" />
            </Button>
          </div>
        </div>

        <div class="flex min-h-0 flex-1 flex-col">
          <!-- 图谱 tab：泳道图谱 + 行内提交详情 -->
          <GitCommitsSection v-if="gitStore.activeDiffTab === 'graph'" />

          <!-- 文件 diff tab：与选中文件一致（selectFile 在 openFileTab 内完成加载） -->
          <template v-else>
            <div v-if="gitStore.selectedPath" class="flex flex-none items-center gap-1 pb-1">
              <FileLabel
                :path="gitStore.selectedPath"
                class="min-w-0 flex-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
              />
            </div>
            <p
              v-if="gitStore.diffLoading"
              class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
            >
              {{ t("panels.loadingDiff") }}
            </p>
            <DiffView
              v-else-if="gitStore.diff"
              :diff="gitStore.diff"
              :path="gitStore.selectedPath"
              commentable
              @comment="addReviewComment"
            />
            <p
              v-else
              class="m-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-dim)]"
            >
              {{ t("panels.noDiffContent") }}
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
