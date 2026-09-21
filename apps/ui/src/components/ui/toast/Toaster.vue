<script setup lang="ts">
import type { ToastItem } from "./useToast";
import { CircleCheck, Info, TriangleAlert, X } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToasts } from "./useToast";

const kindIcon: Record<ToastItem["kind"], typeof Info> = {
  ok: CircleCheck,
  err: TriangleAlert,
  info: Info,
};

const kindClass: Record<ToastItem["kind"], string> = {
  ok: "text-[var(--color-ok)]",
  err: "text-[var(--color-danger-fg)]",
  info: "text-[var(--color-mut)]",
};

const { toasts, dismiss } = useToasts();
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex flex-col items-center gap-2"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="pointer-events-auto flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-popover)] py-2 pl-3 pr-1.5 shadow-[var(--shadow-pop)]"
        role="status"
      >
        <component :is="kindIcon[item.kind]" class="size-4 shrink-0" :class="cn(kindClass[item.kind])" aria-hidden="true" />
        <span class="max-w-[420px] text-[12.5px] text-[var(--color-txt)]">{{ item.message }}</span>
        <Button variant="ghost" size="icon-xs" aria-label="关闭提示" class="shrink-0" @click="dismiss(item.id)">
          <X />
        </Button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--motion-base) var(--ease-enter),
    transform var(--motion-base) var(--ease-enter);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
