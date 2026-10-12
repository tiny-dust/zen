<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Gauge,
  GitBranch,
  GitPullRequestArrow,
  Info,
  RefreshCw,
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import BranchPicker from "@/components/session/BranchPicker.vue";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";
import { openAppLink } from "@/lib/browser-element";
import { useGitStore } from "@/stores/git";
import { cn } from "@/lib/utils";

const emit = defineEmits<{
  openCommit: [];
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const gitStore = useGitStore();
const branchAnchor = ref<HTMLElement | null>(null);
const branchPopup = ref<HTMLElement | null>(null);
const branchPos = ref({ top: 0, left: 0, width: 0 });
const open = ref(true);

const branch = computed(() => gitStore.branch || chatStore.branch);
const contextUsage = computed(() => chatStore.contextUsage);
const lastRequestUsage = computed(() => chatStore.lastRequestUsage);
const estimatedUsage = computed(() => chatStore.estimatedUsage);
/** 悬浮说明：区分「上次请求输入」与「估算当前」（chat store 共用逻辑） */
const contextTitle = computed(() => chatStore.contextUsageTitle);

const prLabel = computed(() => {
  const pr = gitStore.pullRequest;
  if (!pr) {
    return t("shell.noPullRequest");
  }
  return `PR #${pr.number} · ${pr.title}`;
});

/** 提交/推送进行中的行内文案；状态在 store，即使提交弹窗被关闭，这里也能持续展示 loading */
const opRunningLabel = computed(() => {
  switch (gitStore.opBusy) {
    case "commit":
      return t("shell.committing");
    case "commit-push":
      return t("shell.committingAndPushing");
    case "push":
      return t("shell.pushing");
    default:
      return "";
  }
});

function onDocPointerDown(event: PointerEvent) {
  if (!gitStore.branchPickerOpen) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  // 弹层 Teleport 到 body 后不在锚点内，点弹层内部不能算外部点击
  const inside =
    (!!branchAnchor.value && branchAnchor.value.contains(target)) ||
    (!!branchPopup.value && branchPopup.value.contains(target));
  if (!inside) {
    gitStore.branchPickerOpen = false;
  }
}

/** 切换分支弹层：信息卡 overflow-y-auto 会裁剪内部定位弹层，弹层 Teleport 到 body 后按锚点 fixed 定位（同 CommitPanel） */
function toggleBranchPicker() {
  gitStore.branchPickerOpen = !gitStore.branchPickerOpen;
  if (!gitStore.branchPickerOpen) {
    return;
  }
  const rect = branchAnchor.value?.getBoundingClientRect();
  if (rect) {
    branchPos.value = {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    };
  }
  void gitStore.refreshBranches();
}

onMounted(() => {
  void gitStore.refreshStatus();
  gitStore.startStatusWatch();
  document.addEventListener("pointerdown", onDocPointerDown, true);
});

onUnmounted(() => {
  gitStore.stopStatusWatch();
  document.removeEventListener("pointerdown", onDocPointerDown, true);
});

const actionCls = cn(
  "flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left text-[13px] text-[var(--color-txt)]",
  "hover:bg-[var(--color-menu-hover)]",
);
/** 节内行图标：行是 items-center，勿加 mt（加了会沉到文字中心下方 1px） */
const envIconCls = "size-3.5 flex-none text-[var(--color-mut)]";
/** 说明行缩进：与上方行内文本同列（按钮 1px 边框 + 行内边距 4px + 图标 14px + 间距 8px = 27px） */
const noteIndentCls = "flex min-h-7 items-center gap-2 py-0.5 pl-[27px] text-[12px] text-[var(--color-dim)]";
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead :icon="Info" :title="t('shell.envInfo')" :open="open" @toggle="open = !open" />

    <div v-if="open" class="mt-1 flex flex-col">
      <div
        v-if="contextUsage != null"
        class="flex min-h-8 items-center gap-2 px-[5px] text-[13px] text-[var(--color-txt)]"
        :title="contextTitle"
      >
        <Gauge :class="envIconCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ t("shell.context") }}</span>
        <span
          class="flex-none font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        >
          <template v-if="lastRequestUsage != null && estimatedUsage != null">
            {{ lastRequestUsage }}% · {{ t("shell.estimatedPercent", { n: estimatedUsage }) }}
          </template>
          <template v-else-if="lastRequestUsage != null">{{ lastRequestUsage }}%</template>
          <template v-else>{{ t("shell.estimatedPercent", { n: estimatedUsage }) }}</template>
        </span>
      </div>

      <!-- 压缩焦点：随下一次自动压缩消费 -->
      <Input
        v-model="chatStore.compressFocus"
        variant="ghost"
        class="h-7 pl-[27px] pr-1 text-[12px] md:text-[12px] text-[var(--color-txt)] placeholder:text-[var(--color-mut)]"
        :placeholder="t('shell.compressFocusPlaceholder')"
        :title="t('shell.compressFocusTitle')"
      />

      <!-- 变更文件 -->
      <Button
        variant="ghost"
        class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
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
        <span class="min-w-0 flex-1">{{ t("shell.changedFiles") }}</span>
        <span class="flex-none font-[family-name:var(--font-mono)] text-[11px]">
          <span class="text-[var(--color-add)]">+{{ gitStore.totalAdd }}</span>
          <span class="text-[var(--color-del)]">&nbsp;-{{ gitStore.totalDel }}</span>
        </span>
        <ChevronRight class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      </Button>

      <!-- 当前分支 -->
      <div ref="branchAnchor" class="relative flex flex-col">
        <Button
          variant="ghost"
          class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
          :class="actionCls"
          :aria-label="t('shell.switchBranch')"
          :title="branch ? t('shell.currentBranchTitle', { branch }) : t('shell.selectBranch')"
          @click="toggleBranchPicker"
        >
          <GitBranch :class="envIconCls" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[12px]">
            {{ branch || t("shell.selectBranch") }}
          </span>
          <span
            v-if="gitStore.status?.ahead || gitStore.status?.behind"
            class="flex-none font-[family-name:var(--font-mono)] text-[11px]"
            :title="t('shell.upstreamDiffTitle')"
          >
            <span v-if="gitStore.status?.ahead" class="text-[var(--color-add)]">
              ↑{{ gitStore.status.ahead }}
            </span>
            <span v-if="gitStore.status?.behind" class="text-[var(--color-err)]">
              &nbsp;↓{{ gitStore.status.behind }}
            </span>
          </span>
          <ChevronDown class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
        </Button>
        <!-- 信息卡 overflow-y-auto 会裁剪内部弹层：Teleport 到 body + fixed 定位（同 SessionInfoPanel 的 CommitPanel） -->
        <Teleport to="body">
          <div
            v-if="gitStore.branchPickerOpen"
            ref="branchPopup"
            class="fixed z-[var(--z-popup)]"
            :style="{
              top: `${branchPos.top}px`,
              left: `${branchPos.left}px`,
              width: `${branchPos.width}px`,
            }"
          >
            <BranchPicker @close="gitStore.branchPickerOpen = false" />
          </div>
        </Teleport>
      </div>

      <!-- 提交或推送：操作进行中时展示 loading（弹窗关闭后操作继续，行内可见状态） -->
      <Button
        variant="ghost"
        class="h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]"
        :class="actionCls"
        @click="emit('openCommit')"
      >
        <RefreshCw
          v-if="gitStore.opBusy"
          class="size-3.5 flex-none animate-spin text-[var(--color-mut)]"
          aria-hidden="true"
        />
        <GitPullRequestArrow v-else :class="envIconCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          {{ gitStore.opBusy ? opRunningLabel : t("shell.commitOrPush") }}
        </span>
      </Button>
      <div :class="noteIndentCls">
        <span class="min-w-0 flex-1 truncate">
          {{ gitStore.pullRequest ? prLabel : t("shell.noPullRequest") }}
        </span>
        <a
          v-if="gitStore.pullRequest"
          :href="gitStore.pullRequest.url"
          class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          target="_blank"
          rel="noreferrer"
          @click.prevent.stop="openAppLink(gitStore.pullRequest.url)"
        >
          <ExternalLink class="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <p v-if="gitStore.feedback" class="m-0 pl-[27px] text-[11px] text-[var(--color-mut)]" role="status">
        {{ gitStore.feedback }}
      </p>
    </div>
  </section>
</template>
