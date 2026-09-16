<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * 不可撤销操作的二次确认：危险色主按钮 + 明确的删除对象与后果说明。
 * Enter = 确认，Esc / 点遮罩 = 取消。
 *
 * reka 的 FocusScope 打开时自动聚焦 DOM 中第一个可聚焦元素，因此「确认」按钮
 * 在模板里排在前面（视觉顺序由 order-* 保持为取消在左、确认在右）。
 * 不要调换这里的 DOM 顺序，否则初始焦点会落在取消上。
 */
withDefaults(
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
        <Button
          variant="destructive"
          size="sm"
          class="order-2"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="order-1"
          :disabled="pending"
          @click="emit('update:open', false)"
        >
          {{ cancelLabel }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
