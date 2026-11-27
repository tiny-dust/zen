<script setup lang="ts">
import { storeToRefs } from "pinia";
import { watch } from "vue";
import { useI18n } from "vue-i18n";

import AgentsPanel from "@/components/right/AgentsPanel.vue";
import BrowserPanel from "@/components/right/BrowserPanel.vue";
import ErrorsPanel from "@/components/right/ErrorsPanel.vue";
import ExternalSessionsPanel from "@/components/right/ExternalSessionsPanel.vue";
import FilePanel from "@/components/right/FilePanel.vue";
import GitPanel from "@/components/right/GitPanel.vue";
import RightTerminalsPanel from "@/components/right/RightTerminalsPanel.vue";
import ServicesPanel from "@/components/right/ServicesPanel.vue";
import SideChatPanel from "@/components/right/SideChatPanel.vue";
import SkillPanel from "@/components/right/SkillPanel.vue";
import TraceWorkbench from "@/components/trace/TraceWorkbench.vue";
import WorkflowPanel from "@/components/workflow/WorkflowDialog.vue";
import { useBrowserStore } from "@/stores/browser";
import { useChatStore } from "@/stores/chat";
import { sideChatRecordId, useRightPanelStore } from "@/stores/right-panel";

/**
 * 右侧面板本体（对齐 nomi）：标签条在顶栏右段（RightPanelTabs），
 * 这里只按当前标签渲染内容，与中央区共享同一个圆角工作区。
 */
const { t } = useI18n();
const rightPanel = useRightPanelStore();
const browserStore = useBrowserStore();
const chatStore = useChatStore();
const { tabs, activeId, activeTab } = storeToRefs(rightPanel);

/**
 * 侧边对话按主会话隔离：会话切换时旧会话的 side-chat 标签入桶、恢复目标会话自己的标签。
 * 记录列表由常驻顶栏的 RightPanelTabs 按 sessionId 加载；这里只处理标签布局，
 * 只读 sessionId，不碰主会话的消息 / 运行状态 / 模型。
 */
watch(
  () => chatStore.sessionId,
  (id) => {
    rightPanel.bindSideChatScope(id ?? "");
  },
  { immediate: true },
);

/**
 * 内嵌浏览器按工作区隔离：切工作区时把主进程的活动浏览器 scope 对齐到当前
 * 会话工作区。preload 的会话流量拦截覆盖常规切换，这里兜底校正 preload 看不到
 * 的路径（未持久化会话切工作区等）与面板重新展开时的初始值。
 */
watch(
  () => chatStore.sessionWorkspaceId,
  (id) => {
    window.zen?.browser?.setScope?.(id || "common");
  },
  { immediate: true },
);

/**
 * 面板分桶切换完成后（tabs 引用整体替换）修复 store.status 里残留的上一工作区
 * pip 标记：status 未分桶，陈旧 pip 会让 reconcileView / bounds 推送提前跳过，
 * 表现为切过来浏览器面板空白。仅在浏览器 tab 已打开且残留 pip 时刷新对齐。
 */
watch(
  tabs,
  () => {
    if (rightPanel.hasKind("browser") && (browserStore.status.pip || browserStore.status.pipHidden)) {
      void browserStore.syncStatus().then(() => browserStore.reconcileView());
    }
  },
);
</script>

<template>
  <aside class="flex h-full min-w-0 flex-col overflow-hidden" :aria-label="t('panels.panelAria')">
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-1 pb-2"
      role="tabpanel"
      :id="`panel-content-${activeId}`"
      :aria-labelledby="`panel-tab-${activeId}`"
      tabindex="0"
    >
      <FilePanel v-if="activeTab?.kind === 'files'" />
      <BrowserPanel v-else-if="activeTab?.kind === 'browser'" />
      <GitPanel v-else-if="activeTab?.kind === 'git'" />
      <AgentsPanel v-else-if="activeTab?.kind === 'agents'" />
      <RightTerminalsPanel v-else-if="activeTab?.kind === 'terminals'" />
      <ServicesPanel v-else-if="activeTab?.kind === 'services'" />
      <SkillPanel v-else-if="activeTab?.kind === 'skill'" />
      <ErrorsPanel v-else-if="activeTab?.kind === 'errors'" />
      <ExternalSessionsPanel v-else-if="activeTab?.kind === 'external'" />
      <TraceWorkbench v-else-if="activeTab?.kind === 'trace'" />
      <SideChatPanel
        v-else-if="activeTab?.kind === 'side-chat'"
        :key="activeTab.id"
        :chat-id="sideChatRecordId(activeTab.id)"
      />
      <WorkflowPanel v-show="activeTab?.kind === 'workflow'" :active="activeTab?.kind === 'workflow'" />
    </div>
  </aside>
</template>
