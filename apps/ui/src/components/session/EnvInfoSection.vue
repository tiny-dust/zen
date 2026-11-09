<script setup lang="ts">
import { Download, Info, RefreshCw } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ExportSessionDialog from "@/components/session/ExportSessionDialog.vue";
import RepoPanel from "@/components/session/RepoPanel.vue";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { useChatStore } from "@/stores/chat";
import { useSessionWorktreeStore } from "@/stores/session-worktree";

/**
 * 会话信息「环境信息」节：
 * - 直接平铺当前工作目录下发现的所有 Git 仓库，每个仓库一个折叠面板，
 *   展开后管理该仓库的变更/diff、分支、提交推送拉取、PR 与贮藏（见 RepoPanel）；
 * - 底部「导出会话」聚合入口：格式清单来自 @zen/shared 的 SESSION_EXPORT_FORMATS，
 *   新增导出格式只加注册表一项，菜单自动出现。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const gitStore = useGitStore();
const open = ref(true);
/** 展开的仓库（按 path 记录）：默认展开扫描目录自身（"."）的仓库 */
const openRepos = ref(new Set<string>());

const repos = computed(() => gitStore.repositories);
const worktrees = useSessionWorktreeStore();
/** 当前会话绑定的工作树：环境信息展示的是工作树内的仓库 */
const worktree = computed(() => worktrees.current(chatStore.sessionId));

// 工作树创建/移除会换掉扫描根：显式重扫一次，保证面板立刻指向工作树而不是主仓库
watch(
  () => worktree.value?.path ?? "",
  () => void gitStore.refreshRepositories(),
);

watch(
  () => repos.value.map((repo) => repo.path).join("\0"),
  () => {
    const next = new Set<string>();
    const primary =
      repos.value.find((repo) => repo.relativePath === ".") ?? repos.value[0];
    if (primary) next.add(primary.path);
    for (const path of openRepos.value) {
      if (repos.value.some((repo) => repo.path === path)) next.add(path);
    }
    openRepos.value = next;
  },
  { immediate: true },
);

function toggleRepo(path: string) {
  const next = new Set(openRepos.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  openRepos.value = next;
}

async function openInGitPanel(path: string) {
  await gitStore.selectRepository(path);
  gitStore.openGitPanel();
}

async function rescan() {
  await gitStore.refreshRepositories();
}

onMounted(() => {
  void gitStore.refreshRepositories();
});

// 导出会话：统一走 ExportSessionDialog（格式 + 是否含思考）
const exportOpen = ref(false);

</script>

<template>
  <section class="flex flex-col">
    <div class="flex min-w-0 items-center gap-1">
      <SessionSectionHead
        class="min-w-0 flex-1"
        :icon="Info"
        :title="t('shell.envInfo')"
        :open="open"
        @toggle="open = !open"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :aria-label="t('shell.rescanRepos')"
        :title="t('shell.rescanRepos')"
        :disabled="gitStore.repositoriesLoading"
        @click="rescan"
      >
        <RefreshCw
          class="size-3.5"
          :class="gitStore.repositoriesLoading ? 'animate-spin' : ''"
          aria-hidden="true"
        />
      </Button>
    </div>

    <div v-if="open" class="mt-1 flex min-w-0 flex-col gap-2 px-1">
      <p
        v-if="gitStore.repositoriesLoading && !repos.length"
        class="m-0 py-1 text-[11px] text-[var(--color-dim)]"
      >
        {{ t("shell.loadingRepos") }}
      </p>
      <p
        v-else-if="!repos.length"
        class="m-0 py-1 text-[11px] text-[var(--color-dim)]"
      >
        {{ t("shell.noRepos") }}
      </p>

      <p
        v-if="worktree"
        class="m-0 truncate px-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        :title="worktree.path"
      >
        {{ t("worktree.envHint", { branch: worktree.branch }) }}
      </p>

      <RepoPanel
        v-for="repo in repos"
        :key="repo.path"
        :repo="repo"
        :worktree-path="worktree?.path"
        :open="openRepos.has(repo.path)"
        @toggle="toggleRepo(repo.path)"
        @open-panel="openInGitPanel"
      />

      <p v-if="gitStore.repositoryError" class="m-0 text-[11px] text-[var(--color-err)]" role="alert">
        {{ gitStore.repositoryError }}
      </p>

      <Button
        variant="ghost"
        class="mt-1 h-auto min-h-8 w-full justify-start gap-2 rounded-[var(--radius-sm)] px-1 text-[13px] font-normal text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]"
        :disabled="!chatStore.sessionId"
        :title="t('features.exportSessionTitle')"
        @click="exportOpen = true"
      >
        <Download class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-left">{{ t("features.exportSession") }}</span>
      </Button>
      <ExportSessionDialog
        v-model:open="exportOpen"
        :session-id="chatStore.sessionId"
        :session-title="chatStore.sessionName"
      />
    </div>
  </section>
</template>
