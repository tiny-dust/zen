<script setup lang="ts">
import {
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

const emit = defineEmits<{
  close: [];
}>();

const gitStore = useGitStore();
const message = ref("");
const includeUnstaged = ref(true);
const busy = ref(false);
const generating = ref(false);
const error = ref("");
const branchMenuOpen = ref(false);

const branchLabel = computed(() => gitStore.branch || "—");
const stats = computed(() => ({
  add: gitStore.totalAdd,
  del: gitStore.totalDel,
}));

const localBranches = computed(() => gitStore.branches.local);
const remoteBranches = computed(() =>
  gitStore.branches.remote.filter((item) => item.name !== "HEAD"),
);

const messagePlaceholder = computed(() =>
  generating.value
    ? "正在分析变更并生成提交信息…"
    : "提交信息（留空则按变更内容自动分批提交）…",
);

function canSubmit() {
  return !busy.value && gitStore.hasChanges;
}

async function ensureBranches() {
  if (!gitStore.branches.local.length) {
    await gitStore.refreshBranches();
  }
}

/** 用当前选中模型分析变更并填充 commit message */
async function generateMessage() {
  const zen = window.zen;
  if (!zen?.git || generating.value) {
    return;
  }
  generating.value = true;
  error.value = "";
  try {
    const text = await zen.git.aiMessage(gitStore.cwd());
    if (text) {
      message.value = text;
    } else if (!message.value.trim()) {
      error.value = "模型未返回内容，可手动填写";
    }
  } catch (err) {
    if (!message.value.trim()) {
      error.value = err instanceof Error ? err.message : "生成提交信息失败";
    }
  } finally {
    generating.value = false;
  }
}

async function switchBranch(name: string) {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await gitStore.checkout(name);
    if (!result.ok) {
      error.value = result.error ?? "切换分支失败";
    }
  } finally {
    busy.value = false;
  }
}

async function submit(mode: "commit" | "commit-push" | "push") {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    if (mode === "push") {
      const result = await gitStore.push();
      if (!result.ok) {
        error.value = result.error ?? "推送失败";
        return;
      }
      emit("close");
      return;
    }

    // 手动填写 message：尊重显式意图，单条提交；留空则按变更内容自动分批提交
    if (message.value.trim()) {
      const paths = gitStore.files.map((item) => item.path);
      const result = await gitStore.commit(message.value, paths, {
        push: mode === "commit-push",
        includeUnstaged: includeUnstaged.value,
      });
      if (!result.ok) {
        error.value = result.error ?? "提交失败";
        return;
      }
      message.value = "";
      emit("close");
      return;
    }

    const paths = gitStore.files
      .filter((item) => includeUnstaged.value || (item.x !== " " && !item.untracked))
      .map((item) => item.path);
    const result = await gitStore.commitBatched(paths, { push: mode === "commit-push" });
    if (!result.ok) {
      error.value =
        result.batches.length > 0
          ? `${result.error ?? "部分批次提交失败"}（已完成 ${result.batches.length} 批）`
          : (result.error ?? "提交失败");
      return;
    }
    message.value = "";
    emit("close");
  } finally {
    busy.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void submit("commit");
  }
  if (event.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  void gitStore.refreshStatus();
  void ensureBranches();
  gitStore.startStatusWatch();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  gitStore.stopStatusWatch();
  window.removeEventListener("keydown", onKeydown);
});

const rowCls = cn(
  "flex w-full items-center justify-start gap-2 rounded-[var(--radius-sm)] px-2 py-[7px] text-left text-[13px] text-[var(--color-txt)]",
  "hover:bg-[var(--color-menu-hover)] disabled:pointer-events-none disabled:opacity-40",
);
</script>

<template>
  <!-- 1:1 对齐截图：紧凑菜单卡，无外框按钮、无关闭钮 -->
  <div
    class="flex w-[228px] flex-col rounded-[10px] border border-[var(--color-line)] bg-[var(--color-popover)] py-1 shadow-[var(--shadow-pop)]"
    role="dialog"
    aria-label="提交或推送"
  >
    <div class="px-2.5 pt-1.5 pb-0.5">
      <DropdownMenu v-model:open="branchMenuOpen">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            class="flex h-auto items-center gap-1.5 self-start rounded-[6px] px-1 py-0.5 text-[13px] font-normal text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)] aria-expanded:bg-transparent aria-expanded:text-[var(--color-txt-strong)]"
            @mouseenter="ensureBranches"
          >
            <GitBranch class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
            <span class="max-w-[110px] truncate font-[family-name:var(--font-mono)] text-[12.5px]">
              {{ branchLabel }}
            </span>
            <span
              v-if="gitStore.status?.ahead || gitStore.status?.behind"
              class="flex-none font-[family-name:var(--font-mono)] text-[10px]"
              title="与上游分支差异（↑ 待推送 / ↓ 落后）"
            >
              <span v-if="gitStore.status?.ahead" class="text-[var(--color-add)]">
                ↑{{ gitStore.status.ahead }}
              </span>
              <span v-if="gitStore.status?.behind" class="text-[var(--color-err)]">
                &nbsp;↓{{ gitStore.status.behind }}
              </span>
            </span>
            <ChevronDown class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="max-h-[280px] w-[200px] overflow-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
              本地分支
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="item in localBranches"
              :key="item.name"
              class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
              @select="switchBranch(item.name)"
            >
              <Check v-if="item.current" class="size-3.5 flex-none" aria-hidden="true" />
              <span v-else class="size-3.5 flex-none" aria-hidden="true" />
              <span class="truncate">{{ item.name }}</span>
            </DropdownMenuItem>
            <DropdownMenuLabel class="mt-1 text-[11px] text-[var(--color-dim)]">
              远程分支
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="item in remoteBranches"
              :key="item.name"
              class="gap-1.5 font-[family-name:var(--font-mono)] text-[12px]"
              @select="switchBranch(item.name)"
            >
              <span class="size-3.5 flex-none" aria-hidden="true" />
              <span class="truncate">{{ item.name }}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="px-2.5 py-2">
      <Textarea
        v-model="message"
        rows="2"
        variant="ghost"
        :placeholder="messagePlaceholder"
        :disabled="generating"
        class="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--color-txt-strong)] outline-none placeholder:text-[var(--color-composer-placeholder)] disabled:opacity-70 field-sizing-fixed md:text-[13px]"
      />
      <div class="flex items-center justify-end pt-0.5">
        <Button
          variant="ghost"
          class="flex h-auto items-center gap-1 rounded px-1 py-0.5 text-[11px] font-normal text-[var(--color-dim)] hover:bg-transparent hover:text-[var(--color-txt)] dark:hover:bg-transparent disabled:pointer-events-none disabled:opacity-40"
          :disabled="generating || !gitStore.hasChanges"
          title="AI 生成提交信息"
          @click="generateMessage"
        >
          <RefreshCw class="size-3" :class="generating ? 'animate-spin' : ''" aria-hidden="true" />
          {{ generating ? "生成中" : "AI 生成" }}
        </Button>
      </div>
    </div>

    <label
      class="mx-1.5 flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 text-[13px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
    >
      <Checkbox v-model="includeUnstaged" class="size-4" />
      <span class="min-w-0 flex-1">包含未暂存的更改</span>
      <span class="flex-none font-[family-name:var(--font-mono)] text-[12px]">
        <span class="text-[var(--color-add)]">+{{ stats.add }}</span>
        <span class="text-[var(--color-del)]">&nbsp;-{{ stats.del }}</span>
      </span>
    </label>

    <p
      v-if="error"
      class="m-0 px-3 py-1 text-[11px] text-[var(--color-danger-fg)]"
      role="alert"
    >
      {{ error }}
    </p>

    <div class="mt-1 h-px flex-none bg-[var(--color-line)]" aria-hidden="true" />

    <div class="flex flex-col py-0.5">
      <Button
        variant="ghost"
        class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
        :class="rowCls"
        :disabled="!canSubmit()"
        @click="submit('commit')"
      >
        <ArrowRight class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span class="flex-1">提交</span>
        <span class="flex-none font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">
          ⌘↵
        </span>
      </Button>
      <Button
        variant="ghost"
        class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
        :class="rowCls"
        :disabled="!canSubmit()"
        @click="submit('commit-push')"
      >
        <RefreshCw
          v-if="busy"
          class="size-3.5 flex-none animate-spin text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <GitCommitHorizontal
          v-else
          class="size-3.5 flex-none text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <span class="flex-1">提交并推送</span>
      </Button>
      <Button
        variant="ghost"
        class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
        :class="rowCls"
        :disabled="!gitStore.branch || busy"
        @click="submit('push')"
      >
        <RefreshCw
          v-if="busy"
          class="size-3.5 flex-none animate-spin text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <RefreshCw
          v-else
          class="size-3.5 flex-none text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <span class="flex-1">推送</span>
      </Button>
    </div>
  </div>
</template>
