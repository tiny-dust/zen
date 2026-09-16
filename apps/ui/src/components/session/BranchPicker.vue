<script setup lang="ts">
import { Check, GitBranch, GitBranchPlus, Loader2 } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

const emit = defineEmits<{
  close: [];
}>();

const gitStore = useGitStore();
const busy = ref(false);
const error = ref("");
const filter = ref("");
const creating = ref(false);
const newBranch = ref("");

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
      error.value = result.error ?? "切换分支失败";
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
    const result = await gitStore.createBranch(name);
    if (result.ok) {
      newBranch.value = "";
      creating.value = false;
      emit("close");
    } else {
      error.value = result.error ?? "创建分支失败";
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
    <div class="flex items-center gap-1.5 px-1">
      <GitBranch class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
      <input
        v-model="filter"
        placeholder="筛选分支"
        class="h-7 min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
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
        aria-label="新建分支"
        title="新建分支"
        @click="creating = !creating"
      >
        <GitBranchPlus />
      </Button>
    </div>

    <div v-if="creating" class="flex items-center gap-1 px-1">
      <input
        v-model="newBranch"
        placeholder="新分支名称"
        class="h-7 min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 text-[12px] text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] focus-visible:border-ring"
        @keydown.enter="create"
        @keydown.escape="creating = false"
      />
      <Button variant="secondary" size="xs" :disabled="!newBranch.trim() || busy" @click="create">
        创建
      </Button>
    </div>

    <p v-if="error" class="m-0 px-1 text-[11px] text-[var(--color-danger-fg)]" role="alert">
      {{ error }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto">
      <p class="m-0 px-1.5 py-1 text-[10.5px] font-medium text-[var(--color-dim)]">本地分支</p>
      <button
        v-for="item in localBranches"
        :key="`local-${item.name}`"
        type="button"
        :class="
          cn(
            'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-[family-name:var(--font-mono)] text-[11.5px]',
            item.name === gitStore.branch
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : 'text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]',
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
      </button>

      <p class="m-0 px-1.5 py-1 pt-2 text-[10.5px] font-medium text-[var(--color-dim)]">远程分支</p>
      <button
        v-for="item in remoteBranches"
        :key="`remote-${item.name}`"
        type="button"
        class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
        @click="select(item.name)"
      >
        <span class="size-3.5 flex-none" aria-hidden="true" />
        <span class="truncate">{{ item.name }}</span>
      </button>
    </div>
  </div>
</template>
