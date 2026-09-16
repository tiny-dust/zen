<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { nextTick, ref, watch } from "vue";

/**
 * 不可撤销操作的二次确认：危险色主按钮 + 明确的删除对象与后果说明。
 * 打开时聚焦确认按钮：Enter = 确认，Esc / 点遮罩 = 取消；取消在左。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 请求在途：禁用两个按钮，避免重复提交 */
    pending?: boolean;
  }>(),
  {
    description: "",
    confirmLabel: "删除",
    cancelLabel: "取消",
    pending: false,
  },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
}>();

const confirmEl = ref<{ $el: HTMLButtonElement } | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }
    void nextTick(() => {
      confirmEl.value?.$el?.focus?.();
    });
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent
      class="w-[min(380px,calc(100vw-48px))] gap-1.5 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
      :show-close-button="false"
    >
      <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
        {{ title }}
      </DialogTitle>
      <DialogDescription
        v-if="description"
        class="text-[12.5px] leading-normal text-[var(--color-mut)]"
      >
        {{ description }}
      </DialogDescription>
      <div class="mt-2 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" :disabled="pending" @click="emit('update:open', false)">
          {{ cancelLabel }}
        </Button>
        <Button
          ref="confirmEl"
          variant="destructive"
          size="sm"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
