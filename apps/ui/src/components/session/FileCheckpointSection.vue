<script setup lang="ts">
import { History, RotateCcw } from "@lucide/vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";

import type { FileCheckpoint } from "@zen/shared";

const { t } = useI18n();
const chatStore = useChatStore();
const open = ref(false);
const loading = ref(false);
const items = ref<FileCheckpoint[]>([]);
const feedback = ref("");

/** 展开时才拉取：快照随写文件持续增长，折叠态不值得轮询 */
async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await refresh();
  }
}

async function refresh(): Promise<void> {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  loading.value = true;
  try {
    items.value = await zen.agent.listCheckpoints(chatStore.sessionId);
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function restore(checkpoint: FileCheckpoint): Promise<void> {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  const result = await zen.agent.restoreCheckpoint(chatStore.sessionId, checkpoint.id);
  feedback.value = result.ok
    ? t("shell.checkpointRestored", { path: checkpoint.relativePath })
    : (result.error || t("shell.checkpointRestoreFailed"));
  if (result.ok) {
    await refresh();
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="History"
      :title="t('shell.fileSnapshots')"
      :open="open"
      :count="items.length ? String(items.length) : undefined"
      @toggle="toggle"
    />
    <div v-if="open" class="mt-1 flex flex-col">
      <p v-if="loading" class="m-0 pl-[27px] text-[12px] text-[var(--color-dim)]">
        {{ t("shell.checkpointLoading") }}
      </p>
      <p v-else-if="!items.length" class="m-0 pl-[27px] text-[12px] text-[var(--color-dim)]">
        {{ t("shell.noSnapshots") }}
      </p>
      <ul v-else class="m-0 flex list-none flex-col p-0">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex min-h-8 items-center gap-2 px-[5px] text-[13px] text-[var(--color-txt)]"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate font-[family-name:var(--font-mono)] text-[12px]"
              :title="item.relativePath"
            >
              {{ item.relativePath }}
            </span>
            <span class="text-[11px] text-[var(--color-mut)]">
              {{ formatTime(item.createdAt) }}
            </span>
          </div>
          <Button
            variant="ghost"
            class="h-auto px-1 py-0.5 font-normal dark:hover:bg-[var(--color-menu-hover)]"
            :aria-label="t('shell.checkpointRestore', { path: item.relativePath })"
            :title="t('shell.checkpointRestore', { path: item.relativePath })"
            @click="restore(item)"
          >
            <RotateCcw class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
        </li>
      </ul>
      <p
        v-if="feedback"
        class="m-0 pl-[27px] text-[11px] text-[var(--color-mut)]"
        role="status"
      >
        {{ feedback }}
      </p>
    </div>
  </section>
</template>
