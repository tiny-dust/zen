<script setup lang="ts">
import { ChevronDown, GitBranch } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import BranchPicker from "@/components/session/BranchPicker.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";

/**
 * 输入框底栏的分支切换入口（复用会话信息卡的 BranchPicker）。
 * 弹层本地开关：会话信息卡与底栏可能同时挂载，不共用 gitStore.branchPickerOpen。
 * 锚点在窗口底部，弹层向上展开（fixed + -translate-y-full）。
 */
const props = defineProps<{
  /** 窄底栏：只显示图标 */
  compact?: boolean;
}>();

const chatStore = useChatStore();
const gitStore = useGitStore();

const anchorEl = ref<HTMLElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);
const open = ref(false);
const popupPos = ref({ top: 0, left: 0 });

const branch = computed(() => gitStore.branch || chatStore.branch);

function onDocPointerDown(event: PointerEvent) {
  if (!open.value) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  // 弹层 Teleport 到 body 后不在锚点内，点弹层内部不能算外部点击
  const inside =
    (!!anchorEl.value && anchorEl.value.contains(target)) ||
    (!!popupEl.value && popupEl.value.contains(target));
  if (!inside) {
    close();
  }
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  }
}

function close() {
  open.value = false;
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
}

function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
  // 打开即刷新状态与分支列表；分支列表 BranchPicker 挂载时也会拉一次
  void gitStore.refreshStatus();
  void gitStore.refreshBranches();
}

// 打开后按锚点定位：弹层底边贴锚点上方 6px，左对齐并钳制不越出右侧视口
watch(open, (isOpen) => {
  if (!isOpen) {
    return;
  }
  const rect = anchorEl.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  popupPos.value = {
    top: rect.top - 6,
    left: Math.min(rect.left, Math.max(0, window.innerWidth - 248)),
  };
});

onMounted(() => {
  void gitStore.refreshStatus();
});

onBeforeUnmount(() => {
  if (open.value) {
    close();
  }
});
</script>

<template>
  <!-- 无仓库会话不渲染入口，避免死按钮 -->
  <div v-if="branch" ref="anchorEl" class="flex flex-none items-center">
    <Button
      variant="ghost"
      class="h-7 gap-1 rounded-md px-1.5 font-normal text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
      :class="open ? 'bg-[var(--color-menu-active)]' : ''"
      :aria-label="`切换分支，当前 ${branch}`"
      :title="`当前分支：${branch}（点击切换）`"
      @click="toggle"
    >
      <GitBranch class="size-3.5 flex-none" aria-hidden="true" />
      <span
        v-if="!props.compact"
        class="max-w-[140px] truncate font-[family-name:var(--font-mono)] text-[11px]"
      >
        {{ branch }}
      </span>
      <ChevronDown class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
    </Button>
    <!-- 输入框在窗口底部：弹层向上展开（fixed + -translate-y-full） -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="popupEl"
        class="fixed z-[var(--z-popup)] -translate-y-full"
        :style="{
          top: `${popupPos.top}px`,
          left: `${popupPos.left}px`,
        }"
      >
        <BranchPicker @close="close" />
      </div>
    </Teleport>
  </div>
</template>
