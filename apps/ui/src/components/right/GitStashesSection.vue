<script setup lang="ts">
import { Archive, ArchiveRestore, RefreshCw, Trash2 } from "@lucide/vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import CollapsibleSection from "@/components/right/CollapsibleSection.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";

/** Git 面板「贮藏」分区：贮藏当前变更 / 弹出最新 / 逐条应用与删除 */

const props = defineProps<{ open: boolean }>();
defineEmits<{ toggle: [] }>();

const { t } = useI18n();
const gitStore = useGitStore();

const stashBusy = ref(false);

/** 贮藏当前变更（默认说明，未跟踪文件一并收入） */
async function stashChanges() {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashPush();
  } finally {
    stashBusy.value = false;
  }
}

/** 弹出最新贮藏（应用并删除 stash@{0}） */
async function popLatestStash() {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashApply(0, "pop");
  } finally {
    stashBusy.value = false;
  }
}

async function applyStash(index: number) {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashApply(index, "apply");
  } finally {
    stashBusy.value = false;
  }
}

async function dropStash(index: number) {
  if (stashBusy.value) {
    return;
  }
  stashBusy.value = true;
  try {
    await gitStore.stashDrop(index);
  } finally {
    stashBusy.value = false;
  }
}
</script>

<template>
  <CollapsibleSection
    :title="t('panels.stashesSection')"
    :count="gitStore.stashes.length || undefined"
    :open="props.open"
    @toggle="$emit('toggle')"
  >
    <template #actions>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.stashChanges')"
        :title="t('panels.stashChanges')"
        :disabled="stashBusy"
        @click="stashChanges"
      >
        <Archive />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.popLatestStash')"
        :title="t('panels.popLatestStash')"
        :disabled="stashBusy || !gitStore.stashes.length"
        @click="popLatestStash"
      >
        <ArchiveRestore />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.refreshStashList')"
        :title="t('panels.refreshStashList')"
        @click="gitStore.refreshStashes()"
      >
        <RefreshCw :class="gitStore.stashesLoading ? 'animate-spin' : ''" />
      </Button>
    </template>

    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <p
        v-if="!gitStore.stashes.length"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
      >
        {{ gitStore.stashesLoading ? t("panels.loading") : t("panels.noStashes") }}
      </p>
      <div
        v-for="stash in gitStore.stashes"
        :key="stash.index"
        class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-[var(--color-menu-hover)]"
      >
        <span
          class="w-6 flex-none text-center font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
        >
          #{{ stash.index }}
        </span>
        <span
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]"
          :title="stash.message"
        >
          {{ stash.message }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('panels.applyStash')"
          :title="t('panels.applyStash')"
          :disabled="stashBusy"
          @click="applyStash(stash.index)"
        >
          <ArchiveRestore />
        </Button>
        <DangerIconButton
          :label="t('panels.dropStash')"
          :disabled="stashBusy"
          @click="dropStash(stash.index)"
        >
          <Trash2 />
        </DangerIconButton>
      </div>
    </div>
  </CollapsibleSection>
</template>
