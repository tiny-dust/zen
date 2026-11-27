<script setup lang="ts">
import { IconEye as Eye } from "@tabler/icons-vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat";
import { TRANSCRIPT_VIEWS, useTranscriptView } from "@/stores/transcript-view";

/**
 * 会话详细程度（对照 nomi 的 Transcript view）：
 * 选择只作用于当前会话，优先于全局默认；底部可回到跟随全局。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const { view, globalView, hasOverride, setView, followGlobal } = useTranscriptView(
  () => chatStore.sessionId,
);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="relative text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]"
        :aria-label="t('shell.transcriptView.title')"
        data-testid="titlebar-transcript-view"
      >
        <Eye class="size-4" aria-hidden="true" />
        <span
          v-if="hasOverride"
          class="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--color-accent)]"
          aria-hidden="true"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-[248px]">
      <DropdownMenuLabel class="text-[var(--font-size-xs)] text-[var(--color-dim)]">
        {{ t("shell.transcriptView.title") }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="id in TRANSCRIPT_VIEWS"
        :key="id"
        class="flex flex-col items-start gap-0.5 py-1.5"
        :aria-checked="view === id"
        role="menuitemradio"
        :data-testid="`transcript-view-${id}`"
        @select="setView(id)"
      >
        <span class="flex w-full items-center gap-2">
          <span class="w-3 flex-none text-[var(--color-accent)]" aria-hidden="true">
            {{ view === id ? "✓" : "" }}
          </span>
          <span class="text-[var(--font-size-sm)] text-[var(--color-txt-strong)]">
            {{ t(`shell.transcriptView.${id}`) }}
          </span>
        </span>
        <span class="pl-5 text-[var(--font-size-xs)] leading-snug text-[var(--color-dim)]">
          {{ t(`shell.transcriptView.${id}Desc`) }}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        role="menuitemradio"
        :aria-checked="!hasOverride"
        data-testid="transcript-view-global"
        @select="followGlobal()"
      >
        <span class="w-3 flex-none text-[var(--color-accent)]" aria-hidden="true">
          {{ !hasOverride ? "✓" : "" }}
        </span>
        <span class="text-[var(--font-size-sm)]">
          {{ t("shell.transcriptView.followGlobal", { view: t(`shell.transcriptView.${globalView}`) }) }}
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
