<script setup lang="ts">
import { Brain, Plus, RefreshCw, X } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { MemoryScope, MemorySnapshot } from "@zen/shared";

/** 记忆：设备环境快照 + 备注 / 用户习惯（~/.zen/memory） */
const { t } = useI18n();

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
  <section id="set-agent-memory" class="flex flex-col gap-2.5 scroll-mt-2">
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
  </section>
</template>
