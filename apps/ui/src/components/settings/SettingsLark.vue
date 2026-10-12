<script setup lang="ts">
import { Bot, Check, CircleAlert, Download, Pencil, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/stores/agent";

import type { LarkQuickCommand } from "@zen/shared";

/**
 * 飞书桥接：开关走 AgentSettings.larkBridge，状态来自 lark:status / lark:changed
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const { larkStatus, settings } = storeToRefs(agentStore);

const gatewayLabel = computed(() =>
  larkStatus.value ? t(`settings.lark.gateway.${larkStatus.value.gateway}`) : "",
);
const checking = ref(false);
const installing = ref(false);
const testing = ref(false);
const testHint = ref<string | null>(null);
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
    actionError.value = error instanceof Error ? error.message : t("settings.lark.checkFailed");
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
      actionError.value = result.error ?? t("settings.lark.installFailed");
      return;
    }
    await refreshStatus();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : t("settings.lark.installFailed");
  } finally {
    installing.value = false;
  }
}

function setLarkEnabled(enabled: boolean) {
  void agentStore.updateSettings({ larkBridge: { ...settings.value.larkBridge, enabled } });
}

async function sendTestAskCard() {
  if (!window.zen?.lark) {
    return;
  }
  testing.value = true;
  testHint.value = null;
  try {
    const result = await window.zen.lark.testAskCard();
    testHint.value = result.ok
      ? t("settings.lark.testCardOk")
      : (result.error ?? t("settings.lark.testCardFailed"));
  } catch (error) {
    testHint.value = error instanceof Error ? error.message : t("settings.lark.testCardFailed");
  } finally {
    testing.value = false;
  }
}

// ---------- 自定义快捷命令（/别名 → 预设文本；菜单卡片一键点选） ----------
const quickForm = ref({ alias: "", label: "", prompt: "" });
const editingQuickId = ref<string | null>(null);
const quickHint = ref<string | null>(null);

const quickCommands = computed(() => settings.value.larkBridge.quickCommands ?? []);

function saveQuickCommands(next: LarkQuickCommand[]) {
  void agentStore.updateSettings({
    larkBridge: { ...settings.value.larkBridge, quickCommands: next },
  });
}

function startEditQuick(item: LarkQuickCommand) {
  editingQuickId.value = item.id;
  quickForm.value = { alias: item.alias, label: item.label, prompt: item.prompt };
  quickHint.value = null;
}

function cancelEditQuick() {
  editingQuickId.value = null;
  quickForm.value = { alias: "", label: "", prompt: "" };
  quickHint.value = null;
}

function submitQuickCommand() {
  const alias = quickForm.value.alias.trim().replace(/^\/+/, "");
  const prompt = quickForm.value.prompt.trim();
  if (!alias || !prompt) {
    quickHint.value = t("settings.lark.quickHintEmpty");
    return;
  }
  if (!/^[^\s/]+$/.test(alias)) {
    quickHint.value = t("settings.lark.quickHintInvalid");
    return;
  }
  const duplicated = quickCommands.value.some(
    (item) => item.alias.toLowerCase() === alias.toLowerCase() && item.id !== editingQuickId.value,
  );
  if (duplicated) {
    quickHint.value = t("settings.lark.quickHintDuplicate", { alias });
    return;
  }
  const entry: LarkQuickCommand = {
    id: editingQuickId.value ?? `qc-${Date.now()}`,
    alias,
    label: quickForm.value.label.trim() || alias,
    prompt,
  };
  const next = editingQuickId.value
    ? quickCommands.value.map((item) => (item.id === editingQuickId.value ? entry : item))
    : [...quickCommands.value, entry];
  saveQuickCommands(next);
  cancelEditQuick();
}

function removeQuickCommand(id: string) {
  saveQuickCommands(quickCommands.value.filter((item) => item.id !== id));
  if (editingQuickId.value === id) {
    cancelEditQuick();
  }
}
</script>

<template>
  <!-- 飞书桥接：本机 lark-cli 网关（启停与 allowedOpenId 由主进程托管） -->
  <section class="flex flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <Bot :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.lark.bridgeTitle") }}</h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.lark.bridgeDesc") }}
    </p>
    <div
      class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2.5"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.lark.enableTitle") }}</span>
        <span class="text-[11px] text-[var(--color-mut)]">
          {{ t("settings.lark.enableDesc") }}
        </span>
      </div>
      <Switch
        :model-value="settings.larkBridge.enabled"
        :aria-label="t('settings.lark.enableTitle')"
        @update:model-value="(next) => setLarkEnabled(next === true)"
      />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.lark.checkTitle") }}</span>
        <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.lark.checkDesc") }}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="checking || installing" @click="refreshStatus">
          <RefreshCw :size="12" :class="checking ? 'animate-spin' : ''" data-icon="inline-start" />
          {{ checking ? t("settings.lark.checking") : t("settings.lark.recheck") }}
        </Button>
        <Button
          v-if="larkStatus && !larkStatus.auth.cliInstalled"
          variant="outline"
          size="xs"
          :disabled="installing || checking"
          @click="installCli"
        >
          <Download :size="12" data-icon="inline-start" />
          {{ installing ? t("settings.lark.installing") : t("settings.lark.installCli") }}
        </Button>
      </div>
    </div>
    <div v-if="larkStatus" class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="grid gap-1.5 text-[11px] sm:grid-cols-2">
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.cliInstalled" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>{{
            t("settings.lark.cliLabel", {
              status: larkStatus.auth.cliInstalled
                ? t("settings.lark.cliInstalled") +
                  (larkStatus.auth.version ? t("settings.lark.cliVersion", { version: larkStatus.auth.version }) : "")
                : t("settings.lark.cliNotInstalled"),
            })
          }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.userOpenId" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>{{ t("settings.lark.accountLabel", { value: larkStatus.auth.userName ?? t("settings.lark.accountNotLoggedIn") }) }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.botReady" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>{{ t("settings.lark.botLabel", { value: larkStatus.auth.botReady ? t("settings.lark.botReady") : t("settings.lark.botNotReady") }) }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.gateway === 'ready'" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>{{ t("settings.lark.gatewayLabel", { value: gatewayLabel }) }}</span>
        </div>
      </div>
      <div v-if="larkStatus.auth.appId || larkStatus.settings.allowedOpenId" class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-mut)]">
        <span v-if="larkStatus.auth.appId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.auth.appId">
          {{ t("settings.lark.appIdLabel", { value: larkStatus.auth.appId }) }}
        </span>
        <span v-if="larkStatus.settings.allowedOpenId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.settings.allowedOpenId">
          {{ t("settings.lark.allowedOpenIdLabel", { value: larkStatus.settings.allowedOpenId }) }}
        </span>
      </div>
      <p v-if="larkStatus.auth.error" class="m-0 text-[11px] text-[var(--color-err)]">
        {{ larkStatus.auth.error }}
      </p>
      <p v-if="larkStatus.gatewayError" class="m-0 text-[11px] text-[var(--color-err)]">
        {{ larkStatus.gatewayError }}
      </p>
    </div>
    <!-- 自定义快捷命令：/别名 触发 + 菜单卡片按钮一键点选 -->
    <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.lark.quickTitle") }}</span>
        <span class="text-[11px] text-[var(--color-mut)]">
          {{ t("settings.lark.quickDesc") }}
        </span>
      </div>
      <div
        v-for="item in quickCommands"
        :key="item.id"
        class="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line-soft)] px-2.5 py-1.5"
      >
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-[11px] text-[var(--color-txt-strong)]">
            /{{ item.alias }}
            <span v-if="item.label && item.label !== item.alias" class="text-[var(--color-mut)]">· {{ item.label }}</span>
          </span>
          <span class="truncate text-[11px] text-[var(--color-mut)]" :title="item.prompt">{{ item.prompt }}</span>
        </div>
        <div class="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" class="size-6" :aria-label="t('settings.lark.editQuickAria')" @click="startEditQuick(item)">
            <Pencil :size="12" />
          </Button>
          <Button variant="ghost" size="icon" class="size-6" :aria-label="t('settings.lark.deleteQuickAria')" @click="removeQuickCommand(item.id)">
            <Trash2 :size="12" />
          </Button>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="grid gap-1.5 sm:grid-cols-3">
          <Input v-model="quickForm.alias" :placeholder="t('settings.lark.aliasPlaceholder')" class="h-7 text-[11px]" />
          <Input v-model="quickForm.label" :placeholder="t('settings.lark.labelPlaceholder')" class="h-7 text-[11px]" />
          <Input v-model="quickForm.prompt" :placeholder="t('settings.lark.promptPlaceholder')" class="h-7 text-[11px]" />
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button size="xs" @click="submitQuickCommand">
            <Plus v-if="!editingQuickId" :size="12" data-icon="inline-start" />
            {{ editingQuickId ? t("settings.lark.saveChanges") : t("settings.lark.addQuickCommand") }}
          </Button>
          <Button v-if="editingQuickId" variant="outline" size="xs" @click="cancelEditQuick">{{ t("common.cancel") }}</Button>
          <span v-if="quickHint" class="min-w-0 text-[11px] text-[var(--color-err)]">{{ quickHint }}</span>
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-mut)]">
      <div class="font-medium text-[var(--color-txt-strong)]">{{ t("settings.lark.cardCallbackTitle") }}</div>
      <div>
        {{ t("settings.lark.cardCallbackDescA") }}<code>card.action.trigger</code>{{ t("settings.lark.cardCallbackDescB") }}
      </div>
      <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Button variant="outline" size="xs" :disabled="testing" @click="sendTestAskCard">
          {{ testing ? t("settings.lark.sending") : t("settings.lark.sendTestCard") }}
        </Button>
        <span v-if="testHint" class="min-w-0 text-[11px]" :class="testHint.includes('已发送') ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'">
          {{ testHint }}
        </span>
      </div>
    </div>
    <div class="flex flex-col gap-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-mut)]">
      <div class="font-medium text-[var(--color-txt-strong)]">{{ t("settings.lark.guideTitle") }}</div>
      <div>{{ t("settings.lark.guide1a") }}<code>npm install -g @larksuite/cli</code>{{ t("settings.lark.guide1b") }}</div>
      <div>{{ t("settings.lark.guide2") }}</div>
      <div>{{ t("settings.lark.guide3a") }}<code>im.message.receive_v1</code>{{ t("settings.lark.guide3b") }}<code>card.action.trigger</code>{{ t("settings.lark.guide3c") }}</div>
      <div>{{ t("settings.lark.guide4") }}</div>
      <div>{{ t("settings.lark.guide5") }}</div>
    </div>
    <p v-if="actionError" class="m-0 text-[11px] text-[var(--color-err)]">{{ actionError }}</p>
  </section>
</template>
