<script setup lang="ts">
import { GitBranch, RefreshCw } from "@lucide/vue";
import { useI18n } from "vue-i18n";

import type { GitRepository } from "@zen/shared";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";

const { t } = useI18n();
const gitStore = useGitStore();

function location(repo: GitRepository): string {
  if (repo.relativePath === ".") return repo.name;
  if (repo.relativePath === "..") return `${repo.name} (..)`;
  return repo.relativePath;
}

async function select(event: Event) {
  const path = (event.target as HTMLSelectElement).value;
  try {
    await gitStore.selectRepository(path);
  } catch (error) {
    gitStore.repositoryError = error instanceof Error ? error.message : String(error);
  }
}

async function refresh() {
  try {
    await gitStore.refreshRepositories();
    await gitStore.refreshStatus();
  } catch (error) {
    gitStore.repositoryError = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex min-w-0 items-center gap-1.5" role="group" :aria-label="t('panels.gitRepositories')">
      <GitBranch class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
      <select
        :value="gitStore.selectedRepositoryPath"
        :disabled="gitStore.repositoriesLoading || !gitStore.repositories.length || gitStore.mutationBusy"
        :aria-label="t('panels.selectGitRepository')"
        class="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-input-bg)] px-1.5 text-[11px] text-[var(--color-txt)]"
        @change="select"
      >
        <option v-if="!gitStore.repositories.length" value="">
          {{ gitStore.repositoriesLoading ? t("panels.scanningGitRepositories") : t("panels.noGitRepositories") }}
        </option>
        <option v-for="repo in gitStore.repositories" :key="repo.path" :value="repo.path">
          {{ location(repo) }} · {{ gitStore.repositoryBranches[repo.path] || t("panels.unknownGitBranch") }}
        </option>
      </select>
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-7 flex-none"
        :aria-label="t('panels.rescanGitRepositories')"
        :title="t('panels.rescanGitRepositories')"
        :disabled="gitStore.repositoriesLoading || gitStore.mutationBusy"
        @click="refresh"
      >
        <RefreshCw :class="['size-3.5', gitStore.repositoriesLoading ? 'animate-spin' : '']" aria-hidden="true" />
      </Button>
    </div>
    <p v-if="gitStore.repositoryError" class="m-0 text-[11px] text-[var(--color-err)]" role="alert">
      {{ gitStore.repositoryError }}
    </p>
  </div>
</template>
