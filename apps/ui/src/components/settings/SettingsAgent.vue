<script setup lang="ts">
import { FolderOpen, RefreshCw, ShieldCheck, TriangleAlert } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { PermissionMode, SandboxMode } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

/**
 * Agent 与权限：权限三档（默认/智能/完全访问）+ 项目隔离区。
 */
const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { settings, sandboxDir } = storeToRefs(agentStore);
const rebuildBusy = ref(false);
const rebuildMessage = ref("");

const currentProject = computed(() => {
  const group = workspaceStore.groups.find((item) => item.id === workspaceStore.activeId);
  return group && group.kind === "workspace" ? group : null;
});

function pickMode(mode: PermissionMode) {
  void agentStore.updateSettings({ permissionMode: mode });
}

function pickSandbox(mode: SandboxMode) {
  void agentStore.updateSettings({ sandboxMode: mode });
}

async function rebuild() {
  if (!currentProject.value?.path) {
    return;
  }
  rebuildBusy.value = true;
  rebuildMessage.value = "";
  const result = await agentStore.rebuildSandbox(currentProject.value.path);
  rebuildMessage.value = result.ok
    ? "已重建，下次会话生效"
    : (result.error ?? "重建失败");
  rebuildBusy.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 权限模式 -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <ShieldCheck :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">权限管理</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        控制读写文件、执行终端、访问网络等操作是否需要你逐次确认。
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          v-for="item in PERMISSION_MODES"
          :key="item.id"
          type="button"
          class="rounded-xl border p-3 text-left transition-colors"
          :class="
            settings.permissionMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.permissionMode === item.id"
          @click="pickMode(item.id)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ item.label }}
            </span>
            <Badge v-if="item.id === 'full'" variant="secondary" class="text-[10px]">高危</Badge>
          </div>
          <p class="m-0 mt-1 text-[11.5px] leading-snug text-[var(--color-mut)]">
            {{ item.description }}
          </p>
        </button>
      </div>
      <div
        v-if="settings.permissionMode === 'full'"
        class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11.5px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
        完全访问权限下，Agent 可以不经确认执行任何命令与写操作。请仅在完全信任的项目中使用。
      </div>
    </section>

    <!-- 项目隔离区 -->
    <section class="flex flex-col gap-2.5">
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">项目隔离区</h3>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        隔离模式下，项目会复制到 <code
          class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
        >{{ sandboxDir || '~/.zen/sandbox' }}</code> 下操作，源目录不受影响。
      </p>
      <div class="flex gap-2">
        <button
          v-for="item in [
            { id: 'direct' as SandboxMode, label: '直接在项目目录操作', desc: '适合自己的项目，速度最快' },
            { id: 'isolated' as SandboxMode, label: '在隔离区操作', desc: '适合不熟悉的仓库，保护源目录' },
          ]"
          :key="item.id"
          type="button"
          class="flex-1 rounded-xl border p-3 text-left transition-colors"
          :class="
            settings.sandboxMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.sandboxMode === item.id"
          @click="pickSandbox(item.id)"
        >
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ item.label }}</span>
          <p class="m-0 mt-1 text-[11.5px] text-[var(--color-mut)]">{{ item.desc }}</p>
        </button>
      </div>
      <div
        v-if="settings.sandboxMode === 'isolated' && currentProject"
        class="flex items-center gap-2 text-[12px] text-[var(--color-mut)]"
      >
        <span class="min-w-0 flex-1 truncate">
          当前项目：{{ currentProject.name }}（已有隔离副本时直接复用）
        </span>
        <Button variant="outline" size="sm" :disabled="rebuildBusy" @click="rebuild">
          <RefreshCw :size="13" data-icon="inline-start" />重建隔离区
        </Button>
      </div>
      <p v-if="rebuildMessage" class="m-0 text-[11.5px] text-[var(--color-mut)]">
        {{ rebuildMessage }}
      </p>
      <p v-if="chatStore.appInfo" class="m-0 text-[11px] text-[var(--color-dim)]">
        提示：隔离区不会复制 node_modules、.git 等生成物；需要时在会话里让 Agent 重新安装依赖。
      </p>
    </section>
  </div>
</template>
