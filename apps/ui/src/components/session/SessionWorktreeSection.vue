<script setup lang="ts">
import { GitBranchPlus } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useSessionWorktreeStore } from "@/stores/session-worktree";
import { useTerminalStore } from "@/stores/terminal";
import { useWorkspaceStore } from "@/stores/workspace";

const { t } = useI18n();
const chat = useChatStore();
const worktrees = useSessionWorktreeStore();
const workspace = useWorkspaceStore();
const open = ref(false);
const confirmRemove = ref(false);
const removeSessionId = ref("");
const error = ref("");

watch(() => chat.sessionId, () => {
  confirmRemove.value = false;
  removeSessionId.value = "";
  error.value = "";
});

const worktree = computed(() => worktrees.current(chat.sessionId));
const canCreate = computed(() => !!workspace.pathOf(chat.sessionWorkspaceId) && !chat.isRunning);
const busy = computed(() => !!worktrees.busyId);

async function refreshEnvironment() {
  useTerminalStore().bindWorkspaceScope(chat.sessionWorkspaceId);
  await Promise.all([useGitStore().refreshStatus(), chat.refreshGit()]);
}

async function create() {
  const id = chat.sessionId;
  error.value = "";
  try {
    const result = await worktrees.create(id);
    if (chat.sessionId !== id) return;
    if (!result.ok) {
      error.value = result.error ?? t("worktree.createFailed");
      return;
    }
    await refreshEnvironment();
  } catch (cause) {
    if (chat.sessionId === id) error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function startRemove() {
  removeSessionId.value = chat.sessionId;
  confirmRemove.value = true;
}

async function remove() {
  const id = removeSessionId.value;
  if (!id || chat.sessionId !== id) return;
  error.value = "";
  try {
    const result = await worktrees.remove(id);
    if (chat.sessionId !== id) return;
    if (!result.ok) {
      const message = result.error ?? t("worktree.removeFailed");
      error.value = message;
      toast.err(message);
      return;
    }
    confirmRemove.value = false;
    await refreshEnvironment();
  } catch (cause) {
    if (chat.sessionId !== id) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    error.value = message;
    toast.err(message);
  }
}
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="GitBranchPlus"
      :title="t('worktree.title')"
      :count="worktree ? t('worktree.active') : undefined"
      :open="open"
      @toggle="open = !open"
    />
    <div v-if="open" class="flex flex-col gap-1.5 pl-[22px] text-[12px]">
      <template v-if="worktree">
        <p class="m-0 truncate font-[family-name:var(--font-mono)] text-[var(--color-txt)]" :title="worktree.branch">
          {{ worktree.branch }}
        </p>
        <p class="m-0 break-all text-[var(--color-dim)]">{{ worktree.path }}</p>
        <Button
          variant="outline"
          size="xs"
          class="self-start"
          :disabled="busy || chat.isRunning"
          @click="startRemove"
        >
          {{ t('worktree.remove') }}
        </Button>
      </template>
      <template v-else>
        <p class="m-0 text-[var(--color-dim)]">{{ t('worktree.description') }}</p>
        <Button variant="outline" size="xs" class="self-start" :disabled="!canCreate || busy" @click="create">
          {{ t('worktree.create') }}
        </Button>
      </template>
      <p v-if="error" class="m-0 text-[var(--color-err)]" role="alert">{{ error }}</p>
    </div>
    <ConfirmDialog
      v-model:open="confirmRemove"
      :title="t('worktree.removeTitle')"
      :description="t('worktree.removeDescription')"
      :confirm-label="t('worktree.remove')"
      :pending="busy"
      @confirm="remove"
    />
  </section>
</template>
