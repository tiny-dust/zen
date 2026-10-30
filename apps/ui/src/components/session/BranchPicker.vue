<script setup lang="ts">
import { Check, GitBranch, GitBranchPlus, Loader2 } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const busy = ref(false);
const error = ref("");
const filter = ref("");
const creating = ref(false);
const newBranch = ref("");
/** 基分支："" = 当前分支（从 HEAD 创建） */
const baseBranch = ref("");
const repositoryLabel = computed(() => {
  const repo = gitStore.repositories.find((item) => item.path === gitStore.cwd());
  return repo ? (repo.relativePath === "." ? repo.name : repo.relativePath) : "";
});

watch(() => gitStore.cwd(), () => {
  filter.value = "";
  error.value = "";
  creating.value = false;
  newBranch.value = "";
  baseBranch.value = "";
});

const localBranches = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) {
    return gitStore.branches.local;
  }
  return gitStore.branches.local.filter((item) => item.name.toLowerCase().includes(q));
});

const remoteBranches = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const list = gitStore.branches.remote.filter((item) => item.name !== "HEAD");
  if (!q) {
    return list;
  }
  return list.filter((item) => item.name.toLowerCase().includes(q));
});

/** 基分支候选（与上方列表同数据源，不套筛选）：本地去掉当前分支，远程去掉 HEAD */
const baseLocalBranches = computed(() => gitStore.branches.local.filter((item) => !item.current));
const baseRemoteBranches = computed(() =>
  gitStore.branches.remote.filter((item) => item.name !== "HEAD"),
);

async function select(name: string) {
  if (busy.value || name === gitStore.branch) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await gitStore.checkout(name);
    if (result.ok) {
      emit("close");
    } else {
      error.value = result.error ?? t("shell.switchBranchFailed");
    }
  } finally {
    busy.value = false;
  }
}

async function create() {
  const name = newBranch.value.trim();
  if (!name || busy.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const from = baseBranch.value.trim();
    const result = await gitStore.createBranch(name, from || undefined);
    if (result.ok) {
      newBranch.value = "";
      creating.value = false;
      emit("close");
    } else {
      error.value = result.error ?? t("shell.createBranchFailed");
    }
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void gitStore.refreshBranches();
});
</script>

<template>
  <div
    class="flex max-h-[300px] w-[240px] flex-col gap-1.5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-popover)] p-2 shadow-[var(--shadow-menu)]"
  >
    <p v-if="repositoryLabel" class="m-0 truncate px-1 text-[11px] text-[var(--color-dim)]" :title="repositoryLabel">
      {{ t("panels.gitRepositories") }} · {{ repositoryLabel }}
    </p>
    <div class="flex items-center gap-1.5 px-1">
      <GitBranch class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
      <Input
        v-model="filter"
        variant="default"
        :placeholder="t('shell.filterBranches')"
        class="h-7 rounded-md bg-[var(--color-input-bg)] px-2 text-[12px] placeholder:text-[var(--color-composer-placeholder)]"
        @keydown.escape="emit('close')"
      />
      <Loader2
        v-if="gitStore.branchesLoading || busy"
        class="size-3.5 animate-spin text-[var(--color-mut)]"
        aria-hidden="true"
      />
      <Button
        v-else
        variant="ghost"
        size="icon-xs"
        :aria-label="t('shell.newBranch')"
        :title="t('shell.newBranch')"
        @click="creating = !creating"
      >
        <GitBranchPlus />
      </Button>
    </div>

    <div v-if="creating" class="flex flex-col gap-1 px-1">
      <Input
        v-model="newBranch"
        variant="default"
        :placeholder="t('shell.newBranchName')"
        class="h-7 rounded-md bg-[var(--color-input-bg)] px-2 text-[12px] placeholder:text-[var(--color-composer-placeholder)]"
        @keydown.enter="create"
        @keydown.escape="creating = false"
      />
      <div class="flex items-center gap-1">
        <select
          v-model="baseBranch"
          class="h-7 min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-1.5 text-[12px] text-[var(--color-txt)] outline-none"
          :aria-label="t('shell.baseBranch')"
          :title="t('shell.baseBranchTitle')"
        >
          <option value="">{{ t("shell.currentBranch") }}{{ gitStore.branch ? `（${gitStore.branch}）` : "" }}</option>
          <optgroup
            v-if="baseLocalBranches.length"
            class="bg-[var(--color-popover)] text-[var(--color-txt)]"
            :label="t('shell.localBranches')"
          >
            <option
              v-for="item in baseLocalBranches"
              :key="`base-local-${item.name}`"
              :value="item.name"
            >
              {{ item.name }}
            </option>
          </optgroup>
          <optgroup
            v-if="baseRemoteBranches.length"
            class="bg-[var(--color-popover)] text-[var(--color-txt)]"
            :label="t('shell.remoteBranches')"
          >
            <option
              v-for="item in baseRemoteBranches"
              :key="`base-remote-${item.name}`"
              :value="item.name"
            >
              {{ item.name }}
            </option>
          </optgroup>
        </select>
        <Button variant="secondary" size="xs" :disabled="!newBranch.trim() || busy" @click="create">
          {{ t("shell.create") }}
        </Button>
      </div>
    </div>

    <p v-if="error" class="m-0 px-1 text-[11px] text-[var(--color-danger-fg)]" role="alert">
      {{ error }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto">
      <p class="m-0 px-1.5 py-1 text-[10px] font-medium text-[var(--color-dim)]">{{ t("shell.localBranches") }}</p>
      <Button
        v-for="item in localBranches"
        :key="`local-${item.name}`"
        variant="ghost"
        :class="
          cn(
            'h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-[family-name:var(--font-mono)] text-[11px] font-normal',
            item.name === gitStore.branch
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : 'text-[var(--color-txt)]',
          )
        "
        @click="select(item.name)"
      >
        <Check
          v-if="item.current"
          class="size-3.5 flex-none text-[var(--color-ok)]"
          aria-hidden="true"
        />
        <span v-else class="size-3.5 flex-none" aria-hidden="true" />
        <span class="truncate">{{ item.name }}</span>
      </Button>

      <p
        v-if="!localBranches.length"
        class="m-0 px-1.5 py-1.5 text-[11px] text-[var(--color-mut)]"
      >
        {{ gitStore.branch ? t("shell.noMatchBranches") : t("shell.noLocalBranches") }}
      </p>

      <p class="m-0 px-1.5 py-1 pt-2 text-[10px] font-medium text-[var(--color-dim)]">{{ t("shell.remoteBranches") }}</p>
      <Button
        v-for="item in remoteBranches"
        :key="`remote-${item.name}`"
        variant="ghost"
        class="h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-[family-name:var(--font-mono)] text-[11px] font-normal text-[var(--color-txt)]"
        @click="select(item.name)"
      >
        <span class="size-3.5 flex-none" aria-hidden="true" />
        <span class="truncate">{{ item.name }}</span>
      </Button>
      <p
        v-if="!remoteBranches.length"
        class="m-0 px-1.5 py-1.5 text-[11px] text-[var(--color-mut)]"
      >
        {{ t("shell.noRemoteBranches") }}
      </p>
    </div>
  </div>
</template>
