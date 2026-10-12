<script setup lang="ts">
import { Brain, FolderOpen, Plus, RefreshCw, ShieldCheck, TriangleAlert, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { MemoryScope, MemorySnapshot } from "@zen/shared";
import type { PermissionMode, SandboxMode } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

/**
 * Agent 与权限：权限三档（默认/智能/完全访问）+ 项目隔离区 + 记忆。
 */
const { t } = useI18n();
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
    ? t("settings.agent.rebuildOk")
    : (result.error ?? t("settings.agent.rebuildFailed"));
  rebuildBusy.value = false;
}

// ---------- 记忆：设备环境快照 + 备注（Agent updateMemory / 手动维护共用） ----------
const memory = ref<MemorySnapshot | null>(null);
const memoryBusy = ref(false);
const deviceNoteText = ref("");
const userNoteText = ref("");
const pendingDelete = ref<{ scope: MemoryScope; id: string; text: string } | null>(null);
const deleteBusy = ref(false);

const deviceTools = computed(() => Object.entries(memory.value?.device?.tools ?? {}));
const deviceNoteList = computed(() => memory.value?.device?.notes ?? []);
const userNoteList = computed(() => memory.value?.user?.notes ?? []);

async function loadMemory() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memory.value = await zen.memory.get();
}

onMounted(() => {
  void loadMemory();
});

async function addNote(scope: MemoryScope) {
  const zen = window.zen;
  const text = (scope === "device" ? deviceNoteText : userNoteText).value.trim();
  if (!zen?.memory || !text) {
    return;
  }
  memory.value = await zen.memory.addNote(scope, text);
  (scope === "device" ? deviceNoteText : userNoteText).value = "";
}

async function removeNote() {
  const zen = window.zen;
  const target = pendingDelete.value;
  if (!zen?.memory || !target) {
    return;
  }
  deleteBusy.value = true;
  try {
    memory.value = await zen.memory.removeNote(target.scope, target.id);
    pendingDelete.value = null;
  } finally {
    deleteBusy.value = false;
  }
}

async function recollect() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memoryBusy.value = true;
  try {
    memory.value = await zen.memory.collect();
  } finally {
    memoryBusy.value = false;
  }
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 权限模式 -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <ShieldCheck :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.permissionTitle") }}</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        {{ t("settings.agent.permissionDesc") }}
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        <Button
          v-for="item in PERMISSION_MODES"
          :key="item.id"
          variant="ghost"
          class="h-auto flex flex-col whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.permissionMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.permissionMode === item.id"
          @click="pickMode(item.id)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ t(`settings.agent.permission.${item.id}.label`) }}
            </span>
            <Badge v-if="item.id === 'full'" variant="secondary" class="text-[10px]">{{ t("settings.agent.highRisk") }}</Badge>
          </div>
          <p class="m-0 mt-1 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ t(`settings.agent.permission.${item.id}.desc`) }}
          </p>
        </Button>
      </div>
      <div
        v-if="settings.permissionMode === 'full'"
        class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
        {{ t("settings.agent.fullWarning") }}
      </div>
    </section>

    <!-- 项目隔离区 -->
    <section class="flex flex-col gap-2.5">
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.sandboxTitle") }}</h3>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        {{ t("settings.agent.sandboxDescPrefix") }}<code
          class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
        >{{ sandboxDir || '~/.zen/sandbox' }}</code>{{ t("settings.agent.sandboxDescSuffix") }}
      </p>
      <div class="flex gap-2">
        <Button
          v-for="item in [
            { id: 'direct' as SandboxMode, labelKey: 'settings.agent.sandboxDirectLabel', descKey: 'settings.agent.sandboxDirectDesc' },
            { id: 'isolated' as SandboxMode, labelKey: 'settings.agent.sandboxIsolatedLabel', descKey: 'settings.agent.sandboxIsolatedDesc' },
          ]"
          :key="item.id"
          variant="ghost"
          class="h-auto flex flex-col flex-1 whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.sandboxMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.sandboxMode === item.id"
          @click="pickSandbox(item.id)"
        >
          <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t(item.labelKey) }}</span>
          <p class="m-0 mt-1 text-[11px] text-[var(--color-mut)]">{{ t(item.descKey) }}</p>
        </Button>
      </div>
      <div
        v-if="settings.sandboxMode === 'isolated' && currentProject"
        class="flex items-center gap-2 text-[12px] text-[var(--color-mut)]"
      >
        <span class="min-w-0 flex-1 truncate">
          {{ t("settings.agent.currentProject", { name: currentProject.name }) }}
        </span>
        <Button variant="outline" size="sm" :disabled="rebuildBusy" @click="rebuild">
          <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.agent.rebuildSandbox") }}
        </Button>
      </div>
      <p v-if="rebuildMessage" class="m-0 text-[11px] text-[var(--color-mut)]">
        {{ rebuildMessage }}
      </p>
      <p v-if="chatStore.appInfo" class="m-0 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.agent.sandboxTip") }}
      </p>
    </section>

    <!-- 记忆：设备环境 + 用户习惯（~/.zen/memory） -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <Brain :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.memoryTitle") }}</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        {{ t("settings.agent.memoryDesc") }}
      </p>

      <!-- 设备环境快照 -->
      <div
        v-if="memory?.device"
        class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ t("settings.agent.deviceSnapshot") }}
          </span>
          <span class="text-[11px] text-[var(--color-dim)]">
            {{ t("settings.agent.collectedAt", { time: formatTime(memory.device.collectedAt) }) }}
          </span>
          <Button variant="outline" size="sm" :disabled="memoryBusy" @click="recollect">
            <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.agent.recollect") }}
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-mut)]">
          <span>{{ t("settings.agent.deviceSystem", { value: `${memory.device.platform} ${memory.device.arch}` }) }}</span>
          <span class="min-w-0 truncate">{{ t("settings.agent.deviceShell", { value: memory.device.shell }) }}</span>
          <span v-if="memory.device.timezone">
            {{ t("settings.agent.deviceTimezone", { value: memory.device.timezone + (memory.device.locale ? ` · ${memory.device.locale}` : "") }) }}
          </span>
          <span class="min-w-0 truncate">{{ t("settings.agent.deviceHome", { value: memory.device.home }) }}</span>
        </div>
        <div v-if="deviceTools.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="[name, path] in deviceTools"
            :key="name"
            class="inline-flex max-w-full items-baseline gap-1 rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-mut)]"
            :title="`${name} = ${path}`"
          >
            <span class="font-[family-name:var(--font-mono)] text-[var(--color-txt)]">{{ name }}</span>
            <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ path }}</span>
          </span>
        </div>

        <!-- 设备备注 -->
        <div class="flex flex-col gap-1.5 border-t border-[var(--color-line-soft)] pt-2">
          <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.agent.deviceNotes") }}</span>
          <p v-if="!deviceNoteList.length" class="m-0 text-[11px] text-[var(--color-dim)]">
            {{ t("settings.agent.deviceNotesEmpty") }}
          </p>
          <div
            v-for="note in deviceNoteList"
            :key="note.id"
            class="group flex items-start gap-2 text-[11px] text-[var(--color-txt)]"
          >
            <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
            <DangerIconButton
              :label="t('settings.agent.deleteDeviceNoteAria')"
              class="opacity-0 group-hover:opacity-100"
              @click="pendingDelete = { scope: 'device', id: note.id, text: note.text }"
            >
              <X :size="13" />
            </DangerIconButton>
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <Input
              v-model="deviceNoteText"
              variant="ghost"
              class="h-8 text-[12px]"
              :placeholder="t('settings.agent.deviceNotePlaceholder')"
              @keydown.enter.prevent="addNote('device')"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              :aria-label="t('settings.agent.addDeviceNoteAria')"
              :disabled="!deviceNoteText.trim()"
              @click="addNote('device')"
            >
              <Plus :size="14" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 用户习惯备注 -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.agent.userHabits") }}</span>
        <p v-if="!userNoteList.length" class="m-0 text-[11px] text-[var(--color-dim)]">
          {{ t("settings.agent.userHabitsEmpty") }}
        </p>
        <div
          v-for="note in userNoteList"
          :key="note.id"
          class="group flex items-start gap-2 text-[11px] text-[var(--color-txt)]"
        >
          <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
          <DangerIconButton
            :label="t('settings.agent.deleteUserNoteAria')"
            class="opacity-0 group-hover:opacity-100"
            @click="pendingDelete = { scope: 'user', id: note.id, text: note.text }"
          >
            <X :size="13" />
          </DangerIconButton>
        </div>
        <div class="mt-0.5 flex items-center gap-1.5">
          <Input
            v-model="userNoteText"
            variant="ghost"
            class="h-8 text-[12px]"
            :placeholder="t('settings.agent.userNotePlaceholder')"
            @keydown.enter.prevent="addNote('user')"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('settings.agent.addUserNoteAria')"
            :disabled="!userNoteText.trim()"
            @click="addNote('user')"
          >
            <Plus :size="14" />
          </Button>
        </div>
      </div>
    </section>

    <!-- 删除备注二次确认（会落库的删除） -->
    <ConfirmDialog
      :open="pendingDelete != null"
      :title="pendingDelete?.scope === 'user' ? t('settings.agent.deleteUserNoteTitle') : t('settings.agent.deleteDeviceNoteTitle')"
      :description="t('settings.agent.deleteNoteDesc', { text: pendingDelete?.text ?? '' })"
      :confirm-label="t('common.delete')"
      :pending="deleteBusy"
      @update:open="(next) => { if (!next) pendingDelete = null; }"
      @confirm="removeNote"
    />
  </div>
</template>
