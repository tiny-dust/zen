<script setup lang="ts">
import { Bot, Check, CircleAlert, Download, RefreshCw } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
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
const checking = ref(false);
const installing = ref(false);
const actionError = ref<string | null>(null);

onMounted(() => {
  if (!larkStatus.value) {
    void refreshStatus();
  }
});

async function refreshStatus() {
  if (!window.zen?.lark) {
    return;
  }
  checking.value = true;
  actionError.value = null;
  try {
    larkStatus.value = await window.zen.lark.status(true);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "检查飞书状态失败";
  } finally {
    checking.value = false;
  }
}

async function installCli() {
  if (!window.zen?.lark) {
    return;
  }
  installing.value = true;
  actionError.value = null;
  try {
    const result = await window.zen.lark.installCli();
    if (!result.ok) {
      actionError.value = result.error ?? "安装 lark-cli 失败";
      return;
    }
    await refreshStatus();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "安装 lark-cli 失败";
  } finally {
    installing.value = false;
  }
}

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
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">运行前检查</span>
        <span class="text-[11px] text-[var(--color-mut)]">安装 CLI 后，还需要完成飞书账号与机器人身份授权。</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="checking || installing" @click="refreshStatus">
          <RefreshCw :size="12" :class="checking ? 'animate-spin' : ''" data-icon="inline-start" />
          {{ checking ? "检查中" : "重新检查" }}
        </Button>
        <Button
          v-if="larkStatus && !larkStatus.auth.cliInstalled"
          variant="outline"
          size="xs"
          :disabled="installing || checking"
          @click="installCli"
        >
          <Download :size="12" data-icon="inline-start" />
          {{ installing ? "安装中" : "一键安装 lark-cli" }}
        </Button>
      </div>
    </div>
    <div v-if="larkStatus" class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="grid gap-1.5 text-[11.5px] sm:grid-cols-2">
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.cliInstalled" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>lark-cli：{{ larkStatus.auth.cliInstalled ? `已安装${larkStatus.auth.version ? `（${larkStatus.auth.version}）` : ''}` : "未安装" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.userOpenId" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>账号：{{ larkStatus.auth.userName ?? "未登录" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.botReady" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>机器人身份：{{ larkStatus.auth.botReady ? "已就绪" : "未就绪" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.gateway === 'ready'" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>网关：{{ gatewayLabel }}</span>
        </div>
      </div>
      <div v-if="larkStatus.auth.appId || larkStatus.settings.allowedOpenId" class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-mut)]">
        <span v-if="larkStatus.auth.appId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.auth.appId">
          App ID：{{ larkStatus.auth.appId }}
        </span>
        <span v-if="larkStatus.settings.allowedOpenId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.settings.allowedOpenId">
          安全绑定：{{ larkStatus.settings.allowedOpenId }}
        </span>
      </div>
      <p v-if="larkStatus.auth.error" class="m-0 text-[11.5px] text-[var(--color-err)]">
        {{ larkStatus.auth.error }}
      </p>
      <p v-if="larkStatus.gatewayError" class="m-0 text-[11.5px] text-[var(--color-err)]">
        {{ larkStatus.gatewayError }}
      </p>
    </div>
    <div class="flex flex-col gap-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-[11.5px] leading-relaxed text-[var(--color-mut)]">
      <div class="font-medium text-[var(--color-txt-strong)]">使用说明</div>
      <div>1. 点击“一键安装 lark-cli”，或在终端执行 <code>npm install -g @larksuite/cli</code>。</div>
      <div>2. 在设置的“个人资料”页点击“登录”并选择飞书完成授权；启用桥接后，Zen 会自动绑定当前账号的 open_id。</div>
      <div>3. 在飞书开放平台为应用开启机器人能力，并订阅 <code>im.message.receive_v1</code>；卡片问询还需订阅 <code>card.action.trigger</code>。</div>
      <div>4. 在飞书私聊机器人发送“帮助”查看指令；发送“列表”“状态”查看会话，普通文本会在公共区启动 Agent。</div>
      <div>5. 只有安全绑定的账号可以操控 Zen；API Key 与登录 token 不会展示在此页。</div>
    </div>
    <p v-if="actionError" class="m-0 text-[11.5px] text-[var(--color-err)]">{{ actionError }}</p>
  </section>
</template>
