<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Gauge,
  GitBranch,
  GitPullRequestArrow,
  RefreshCw,
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";

import BranchPicker from "@/components/session/BranchPicker.vue";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

const emit = defineEmits<{
  openCommit: [];
}>();

const chatStore = useChatStore();
const gitStore = useGitStore();
const branchAnchor = ref<HTMLElement | null>(null);
const open = ref(true);

const branch = computed(() => gitStore.branch || chatStore.branch);
const contextUsage = computed(() => chatStore.contextUsage);

const prLabel = computed(() => {
  const pr = gitStore.pullRequest;
  if (!pr) {
    return "当前分支暂无拉取请求";
  }
  return `PR #${pr.number} · ${pr.title}`;
});

function onDocPointerDown(event: PointerEvent) {
  if (!gitStore.branchPickerOpen) {
    return;
  }
  const target = event.target as Node | null;
  if (branchAnchor.value && target && !branchAnchor.value.contains(target)) {
    gitStore.branchPickerOpen = false;
  }
}

onMounted(() => {
  void gitStore.refreshStatus();
  document.addEventListener("pointerdown", onDocPointerDown, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
});

const headCls =
  "flex min-h-8 w-full items-center gap-1.5 rounded-[var(--radius-sm)] text-left text-[13px] font-semibold text-[var(--color-txt-strong)] hover:text-[var(--color-txt)]";
const actionCls = cn(
  "flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left text-[13px] text-[var(--color-txt)]",
  "hover:bg-[var(--color-menu-hover)]",
);
const envIconCls = "mt-0.5 size-3.5 flex-none text-[var(--color-mut)]";
</script>

<template>
  <section class="flex flex-col">
    <button type="button" :class="headCls" @click="open = !open">
      环境信息
      <ChevronDown
        class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
        :class="open ? '' : '-rotate-90'"
        aria-hidden="true"
      />
    </button>

    <div v-if="open" class="mt-1 flex flex-col">
      <div v-if="contextUsage != null" class="flex min-h-8 items-start gap-2 py-1 text-[12.5px] text-[var(--color-txt)]">
        <Gauge :class="envIconCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">上下文</span>
        <span class="flex-none font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--color-mut)]">
          {{ contextUsage }}%
        </span>
      </div>

      <!-- 变更文件 -->
      <button
        type="button"
        :class="actionCls"
        :disabled="!gitStore.hasChanges && !gitStore.loading"
        @click="gitStore.openChangesPanel()"
      >
        <RefreshCw
          v-if="gitStore.loading"
          class="size-3.5 flex-none animate-spin text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <CircleCheck v-else :class="envIconCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">变更文件</span>
        <span class="flex-none font-[family-name:var(--font-mono)] text-[11px]">
          <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
          <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
        </span>
        <ChevronRight class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      </button>

      <!-- 当前分支 -->
      <div ref="branchAnchor" class="relative flex flex-col">
        <button
          type="button"
          :class="actionCls"
          @click="
            gitStore.branchPickerOpen = !gitStore.branchPickerOpen;
            if (gitStore.branchPickerOpen) gitStore.refreshBranches();
          "
        >
          <GitBranch :class="envIconCls" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[12px]">
            {{ branch || "—" }}
          </span>
          <span
            v-if="gitStore.status?.ahead || gitStore.status?.behind"
            class="flex-none font-[family-name:var(--font-mono)] text-[11px]"
            title="与上游分支差异（↑ 待推送 / ↓ 落后）"
          >
            <span v-if="gitStore.status?.ahead" class="text-[var(--color-add)]">
              ↑{{ gitStore.status.ahead }}
            </span>
            <span v-if="gitStore.status?.behind" class="text-[var(--color-err)]">
              &nbsp;↓{{ gitStore.status.behind }}
            </span>
          </span>
          <ChevronDown class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        </button>
        <div
          v-if="gitStore.branchPickerOpen"
          class="absolute top-full right-0 left-0 z-[var(--z-popup)] mt-1"
        >
          <BranchPicker @close="gitStore.branchPickerOpen = false" />
        </div>
      </div>

      <!-- 提交或推送 -->
      <button type="button" :class="actionCls" @click="emit('openCommit')">
        <GitPullRequestArrow :class="envIconCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">提交或推送</span>
      </button>
      <div class="flex min-h-7 items-center gap-2 py-0.5 pl-6 text-[12px] text-[var(--color-dim)]">
        <span class="min-w-0 flex-1 truncate">
          {{ gitStore.pullRequest ? prLabel : "当前分支暂无拉取请求" }}
        </span>
        <a
          v-if="gitStore.pullRequest"
          :href="gitStore.pullRequest.url"
          class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          target="_blank"
          rel="noreferrer"
          @click.stop
        >
          <ExternalLink class="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <p v-if="gitStore.feedback" class="m-0 pl-6 text-[11px] text-[var(--color-mut)]" role="status">
        {{ gitStore.feedback }}
      </p>
    </div>
  </section>
</template>
