<script setup lang="ts">
import { GitMerge, Loader2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

/** 合并分支弹窗：列出本地/远程分支，点击即并入当前分支。
 *  冲突时不自动提交——关闭弹窗交由变更面板的合并横幅与冲突文件引导解决 */
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const busy = ref(false);
const error = ref("");

/** 可合并的本地分支（去掉当前分支）与远程分支（去掉 HEAD） */
const localBranches = computed(() => gitStore.branches.local.filter((item) => !item.current));
const remoteBranches = computed(() =>
  gitStore.branches.remote.filter((item) => !item.name.endsWith("/HEAD")),
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = "";
      void gitStore.refreshBranches();
    }
  },
);

function close() {
  emit("update:open", false);
}

async function mergeBranch(name: string) {
  if (busy.value || name === gitStore.branch) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await gitStore.merge(name);
    // 成功或有冲突都关闭弹窗：变更面板的合并横幅接管后续引导；
    // 普通失败（如工作区脏）留在弹窗内展示原因
    if (result.ok || result.conflicts?.length) {
      close();
    } else {
      error.value = result.error ?? t("app.git.mergeFailed");
    }
  } finally {
    busy.value = false;
  }
}

const rowCls =
  "h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-left font-[family-name:var(--font-mono)] text-[11px] font-normal text-[var(--color-txt)]";
const sectionCls = "m-0 px-1 py-1 text-[10px] font-medium text-[var(--color-dim)]";
</script>

<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent
      class="w-[min(320px,calc(100vw-48px))] gap-2 border border-[var(--color-line)] bg-[var(--color-popover)] p-3 shadow-[var(--shadow-pop)]"
    >
      <div class="flex items-center gap-1.5">
        <GitMerge class="size-4 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <DialogTitle class="text-[13px] font-semibold text-[var(--color-txt-strong)]">
          {{ t("panels.mergeDialogTitle") }}
        </DialogTitle>
        <Loader2 v-if="busy || gitStore.branchesLoading" class="size-3.5 animate-spin text-[var(--color-mut)]" aria-hidden="true" />
      </div>
      <DialogDescription class="text-[11px] leading-normal text-[var(--color-mut)]">
        {{ t("panels.mergeDialogDesc") }}
      </DialogDescription>

      <p v-if="error" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
        {{ error }}
      </p>

      <div class="flex max-h-[280px] min-h-0 flex-col overflow-auto">
        <p :class="sectionCls">{{ t("panels.localBranches") }}</p>
        <Button
          v-for="item in localBranches"
          :key="`merge-local-${item.name}`"
          variant="ghost"
          :class="rowCls"
          :disabled="busy"
          @click="mergeBranch(item.name)"
        >
          <span class="truncate">{{ item.name }}</span>
        </Button>

        <p :class="cn(sectionCls, 'pt-2')">{{ t("panels.remoteBranches") }}</p>
        <Button
          v-for="item in remoteBranches"
          :key="`merge-remote-${item.name}`"
          variant="ghost"
          :class="rowCls"
          :disabled="busy"
          @click="mergeBranch(item.name)"
        >
          <span class="truncate">{{ item.name }}</span>
        </Button>

        <p
          v-if="!localBranches.length && !remoteBranches.length"
          class="m-0 px-1 py-1.5 text-[11px] text-[var(--color-mut)]"
        >
          {{ t("panels.noBranchesToMerge") }}
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
