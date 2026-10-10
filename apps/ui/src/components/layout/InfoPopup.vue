<script setup lang="ts">
import { Info } from "@lucide/vue";
import { storeToRefs } from "pinia";

import SessionInfoPanel from "@/components/session/SessionInfoPanel.vue";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLayoutStore } from "@/stores/layout";

const layoutStore = useLayoutStore();
const { infoOpen } = storeToRefs(layoutStore);
</script>

<template>
  <Dialog :open="infoOpen" @update:open="layoutStore.toggleInfo()">
    <DialogContent
      class="flex w-[min(760px,calc(100vw-48px))] max-h-[min(720px,calc(100vh-64px))] flex-col gap-0 overflow-hidden bg-[var(--color-set-card)] p-0"
    >
      <header class="flex flex-none items-center justify-between border-b border-[var(--color-line)] px-4 py-3.5">
        <DialogTitle class="m-0 flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-txt-strong)]">
          <Info class="size-4 text-[var(--color-mut)]" aria-hidden="true" />
          会话信息
        </DialogTitle>
      </header>
      <div class="min-h-0 overflow-auto">
        <SessionInfoPanel embedded />
      </div>
    </DialogContent>
  </Dialog>
</template>
