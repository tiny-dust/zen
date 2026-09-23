<script setup lang="ts">
import { Bot } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";

import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/stores/agent";

import type { LarkGatewayState } from "@zen/shared";

/**
 * 飞书桥接：开关走 AgentSettings.larkBridge，状态来自 lark:status / lark:changed
 */
const agentStore = useAgentStore();
const { larkStatus, settings } = storeToRefs(agentStore);

const LARK_GATEWAY_LABELS: Record<LarkGatewayState, string> = {
  off: "未启动",
  starting: "启动中",
  ready: "运行中",
  error: "异常",
};

const gatewayLabel = computed(() =>
  larkStatus.value ? LARK_GATEWAY_LABELS[larkStatus.value.gateway] : "",
);

function setLarkEnabled(enabled: boolean) {
  void agentStore.updateSettings({ larkBridge: { ...settings.value.larkBridge, enabled } });
}
</script>

<template>
  <!-- 飞书桥接：本机 lark-cli 网关（启停与 allowedOpenId 由主进程托管） -->
  <section class="flex flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <Bot :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">飞书桥接</h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      通过本机已登录的 lark-cli 收发：会话列表查询、运行状态、askUser 问询推送与回复。
    </p>
    <div
      class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2.5"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">启用飞书桥接</span>
        <span class="text-[11.5px] text-[var(--color-mut)]">
          开启后主进程自动拉起 lark-cli 网关并解析允许的用户
        </span>
      </div>
      <Switch
        :model-value="settings.larkBridge.enabled"
        aria-label="启用飞书桥接"
        @update:model-value="(next) => setLarkEnabled(next === true)"
      />
    </div>
    <div
      v-if="larkStatus"
      class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--color-mut)]">
        <span v-if="!larkStatus.auth.available">
          未找到 lark-cli，请先安装并 lark-cli auth login
        </span>
        <template v-else>
          <span>账号：{{ larkStatus.auth.userName ?? "未知用户" }}</span>
          <span
            v-if="larkStatus.auth.appId"
            class="min-w-0 truncate font-[family-name:var(--font-mono)]"
            :title="larkStatus.auth.appId"
          >
            App ID：{{ larkStatus.auth.appId }}
          </span>
        </template>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--color-mut)]">
        <span>网关：{{ gatewayLabel }}</span>
        <span v-if="larkStatus.settings.allowedOpenId">
          已绑定：{{ larkStatus.auth.userName ?? larkStatus.settings.allowedOpenId }}
        </span>
      </div>
      <p v-if="larkStatus.gatewayError" class="m-0 text-[11.5px] text-[var(--color-err)]">
        {{ larkStatus.gatewayError }}
      </p>
    </div>
    <p class="m-0 text-[11px] text-[var(--color-dim)]">
      飞书里给机器人发『列表』『状态』查看会话；问询会推送到飞书，直接回复即可写回会话。
    </p>
  </section>
</template>
