<script setup lang="ts">
import { ArrowRightLeft, Check, GitBranch, GitMerge, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import CollapsibleSection from "@/components/right/CollapsibleSection.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";

import type { GitBranchInfo } from "@zen/shared";

/** Git 面板「分支」分区：本地/远端分支列表，行内切换与合并（替代原合并分支弹窗） */

const props = defineProps<{ open: boolean }>();
defineEmits<{ toggle: [] }>();

const { t } = useI18n();
const gitStore = useGitStore();

const busy = ref(false);

const localBranches = computed(() => gitStore.branches.local);
/** 远端分支去掉 origin/HEAD 指针行 */
const remoteBranches = computed(() =>
  gitStore.branches.remote.filter((item) => !item.name.endsWith("/HEAD")),
);

/** 远端分支行切换：去掉 remote 前缀交给 git DWIM（存在唯一同名远端时建本地跟踪分支） */
function checkoutName(branch: GitBranchInfo): string {
  return branch.remote ? branch.name.slice(branch.remote.length + 1) : branch.name;
}

async function checkoutBranch(branch: GitBranchInfo) {
  if (busy.value || branch.current) {
    return;
  }
  busy.value = true;
  try {
    await gitStore.checkout(checkoutName(branch));
  } finally {
    busy.value = false;
  }
}

async function mergeBranch(branch: GitBranchInfo) {
  if (busy.value || branch.current) {
    return;
  }
  busy.value = true;
  try {
    await gitStore.merge(branch.name);
  } finally {
    busy.value = false;
  }
}

/** 是否可从该分支合并：非当前分支即可（远端分支允许直接并入，如 origin/main） */
function mergeable(branch: GitBranchInfo): boolean {
  return !branch.current;
}
</script>

<template>
  <CollapsibleSection
    :title="t('panels.branchesSection')"
    :count="localBranches.length + remoteBranches.length || undefined"
    :open="props.open"
    @toggle="$emit('toggle')"
  >
    <template #actions>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.refreshBranchList')"
        :title="t('panels.refresh')"
        @click="gitStore.refreshBranches()"
      >
        <RefreshCw :class="gitStore.branchesLoading ? 'animate-spin' : ''" />
      </Button>
    </template>

    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <p
        v-if="!localBranches.length && !remoteBranches.length"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
      >
        {{ gitStore.branchesLoading ? t("panels.loading") : t("panels.noBranches") }}
      </p>

      <template v-if="localBranches.length">
        <p class="m-0 px-1 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-dim)]">
          {{ t("panels.localBranches") }}
        </p>
        <div
          v-for="branch in localBranches"
          :key="branch.name"
          class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-[var(--color-menu-hover)]"
        >
          <GitBranch class="size-3 flex-none text-[var(--color-mut)]" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px]"
            :class="branch.current ? 'text-[var(--color-txt-strong)]' : 'text-[var(--color-txt)]'"
            :title="branch.name"
          >
            {{ branch.name }}
          </span>
          <!-- 当前分支：上游领先/落后徽标 -->
          <span
            v-if="branch.current && (gitStore.status?.ahead || gitStore.status?.behind)"
            class="flex-none font-[family-name:var(--font-mono)] text-[10px]"
            :title="t('panels.upstreamDiffTitle')"
          >
            <span v-if="gitStore.status?.ahead" class="text-[var(--color-add)]">
              ↑{{ gitStore.status.ahead }}
            </span>
            <span v-if="gitStore.status?.behind" class="text-[var(--color-err)]">
              &nbsp;↓{{ gitStore.status.behind }}
            </span>
          </span>
          <Check
            v-if="branch.current"
            class="size-3 flex-none text-[var(--color-accent)]"
            aria-hidden="true"
          />
          <template v-else>
            <Button
              variant="ghost"
              size="icon-xs"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="t('panels.checkoutBranch')"
              :title="t('panels.checkoutBranch')"
              :disabled="busy"
              @click="checkoutBranch(branch)"
            >
              <ArrowRightLeft class="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="t('panels.mergeIntoCurrent')"
              :title="t('panels.mergeIntoCurrent')"
              :disabled="busy"
              @click="mergeBranch(branch)"
            >
              <GitMerge class="size-3" />
            </Button>
          </template>
        </div>
      </template>

      <template v-if="remoteBranches.length">
        <p class="m-0 px-1 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-dim)]">
          {{ t("panels.remoteBranches") }}
        </p>
        <div
          v-for="branch in remoteBranches"
          :key="branch.name"
          class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-[var(--color-menu-hover)]"
        >
          <GitBranch class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
            :title="branch.name"
          >
            {{ branch.name }}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
            :aria-label="t('panels.checkoutBranch')"
            :title="t('panels.checkoutBranch')"
            :disabled="busy"
            @click="checkoutBranch(branch)"
          >
            <ArrowRightLeft class="size-3" />
          </Button>
          <Button
            v-if="mergeable(branch)"
            variant="ghost"
            size="icon-xs"
            class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
            :aria-label="t('panels.mergeIntoCurrent')"
            :title="t('panels.mergeIntoCurrent')"
            :disabled="busy"
            @click="mergeBranch(branch)"
          >
            <GitMerge class="size-3" />
          </Button>
        </div>
      </template>
    </div>
  </CollapsibleSection>
</template>
