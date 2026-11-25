<script setup lang="ts">
import { MonitorSmartphone } from "@lucide/vue";
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { RemoteStatus } from "@/types/zen-api";

const { t } = useI18n();
const config = shallowRef<RemoteStatus | null>(null);
const relayUrl = shallowRef("");
const deviceName = shallowRef("");
const username = shallowRef("");
const password = shallowRef("");
const pairCode = shallowRef("");
const error = shallowRef("");
const pending = shallowRef(false);
const confirmRevoke = shallowRef(false);
let offStatus: (() => void) | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

const phoneUrl = computed(() => {
  if (!config.value?.relayUrl) return "";
  try {
    const url = new URL(config.value.relayUrl);
    url.protocol = "https:";
    url.pathname = "/";
    return url.toString();
  } catch {
    return "";
  }
});

function updateConfig(next: RemoteStatus) {
  config.value = next;
  relayUrl.value = next.relayUrl;
  deviceName.value = next.deviceName;
  username.value = next.username;
  password.value = "";
  if (!next.enabled || next.status !== "connected") pairCode.value = "";
}

onMounted(async () => {
  if (!window.zen?.remote) {
    error.value = t("settings.remote.unavailable");
    return;
  }
  offStatus = window.zen.remote.onStatus((next) => {
    config.value = next;
    if (!next.enabled || next.status !== "connected") pairCode.value = "";
  });
  try {
    updateConfig(await window.zen.remote.getConfig());
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.remote.failed");
  }
});

onUnmounted(() => {
  offStatus?.();
  if (expiryTimer) clearTimeout(expiryTimer);
});

async function saveConfig(enabled: boolean) {
  if (!window.zen?.remote || pending.value) return;
  pending.value = true;
  error.value = "";
  try {
    updateConfig(await window.zen.remote.setConfig({ relayUrl: relayUrl.value, deviceName: deviceName.value, username: username.value, password: password.value, enabled }));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.remote.failed");
  } finally {
    pending.value = false;
  }
}

async function requestCode() {
  if (!window.zen?.remote || pending.value) return;
  pending.value = true;
  error.value = "";
  pairCode.value = "";
  try {
    const result = await window.zen.remote.requestPairCode();
    pairCode.value = result.code;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { pairCode.value = ""; }, Math.max(0, result.expiresAt - Date.now()));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.remote.failed");
  } finally {
    pending.value = false;
  }
}

async function revoke() {
  if (!window.zen?.remote || pending.value) return;
  pending.value = true;
  error.value = "";
  try {
    updateConfig(await window.zen.remote.revoke());
    confirmRevoke.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.remote.failed");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section id="set-remote-bridge" class="flex flex-col gap-3 scroll-mt-2">
    <div class="flex items-center gap-2">
      <MonitorSmartphone :size="15" class="text-[var(--color-mut)]" aria-hidden="true" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.remote.title") }}</h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">{{ t("settings.remote.description") }}</p>
    <div class="flex flex-col gap-3 rounded-xl border border-[var(--color-line)] p-3">
      <label for="remote-relay-url" class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.relayLabel") }}</label>
      <div class="flex flex-wrap items-center gap-2">
        <Input id="remote-relay-url" v-model="relayUrl" :placeholder="t('settings.remote.relayPlaceholder')" class="min-w-[200px] flex-1 text-[12px]" autocomplete="url" spellcheck="false" />
      </div>
      <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.relayHint") }}</p>
      <label for="remote-device-name" class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.deviceName") }}</label>
      <Input id="remote-device-name" v-model="deviceName" maxlength="100" autocomplete="off" />
      <label for="remote-username" class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.username") }}</label>
      <Input id="remote-username" v-model="username" maxlength="100" autocomplete="username" />
      <label for="remote-password" class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.password") }}</label>
      <Input id="remote-password" v-model="password" type="password" maxlength="256" autocomplete="new-password" :placeholder="config?.hasPassword ? t('settings.remote.passwordSaved') : ''" />
      <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.passwordHint") }}</p>
      <Button variant="outline" size="sm" class="self-start" :disabled="pending || !config" @click="saveConfig(config?.enabled ?? false)">{{ t("settings.remote.save") }}</Button>
    </div>
    <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-1">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.enable") }}</span>
        <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.status", { value: t(`settings.remote.states.${config?.status ?? 'disabled'}`) }) }}</span>
      </div>
      <Switch :model-value="config?.enabled ?? false" :disabled="pending || !config" :aria-label="t('settings.remote.enable')" @update:model-value="(value) => saveConfig(value === true)" />
    </div>
    <div v-if="config?.enabled" class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.remote.pairTitle") }}</span>
      <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.pairHint") }}</p>
      <p v-if="phoneUrl" class="m-0 break-all text-[11px] text-[var(--color-txt-strong)]">{{ t("settings.remote.phoneUrl", { url: phoneUrl }) }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" :disabled="pending || config.status !== 'connected'" @click="requestCode">{{ t("settings.remote.generateCode") }}</Button>
        <span v-if="pairCode" class="font-[family-name:var(--font-mono)] text-lg tracking-[0.2em] text-[var(--color-txt-strong)]" role="status">{{ pairCode }}</span>
      </div>
      <p v-if="pairCode" class="m-0 text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.codeExpiry") }}</p>
    </div>
    <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] p-3">
      <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.remote.revokeHint") }}</span>
      <Button variant="destructive" size="sm" :disabled="pending || config?.status !== 'connected'" @click="confirmRevoke = true">{{ t("settings.remote.revoke") }}</Button>
    </div>
    <p v-if="config?.error || error" class="m-0 text-[11px] text-[var(--color-err)]" role="alert">{{ error || config?.error }}</p>
    <ConfirmDialog :open="confirmRevoke" :title="t('settings.remote.revokeTitle')" :description="t('settings.remote.revokeDescription')" :confirm-label="t('settings.remote.revoke')" :pending="pending" @update:open="confirmRevoke = $event" @confirm="revoke" />
  </section>
</template>
