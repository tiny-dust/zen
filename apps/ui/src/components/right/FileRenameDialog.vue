<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * 重命名文件/目录：预填当前名并全选，Enter 或「重命名」提交；
 * 空名/同名/含路径分隔符时禁用提交。确认后由宿主调 workspace:rename-entry。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 当前名称（预填与同名判断） */
    name: string;
    /** 展示用完整路径 */
    path: string;
    /** 请求在途：禁用提交，避免重复提交 */
    pending?: boolean;
  }>(),
  { pending: false },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [newName: string];
}>();

const value = ref("");
const inputRef = ref<InstanceType<typeof Input> | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return;
    }
    value.value = props.name;
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  },
);

function valid(): boolean {
  const next = value.value.trim();
  return !!next && next !== props.name && !next.includes("/") && !next.includes("\\");
}

function submit() {
  if (!props.pending && valid()) {
    emit("confirm", value.value.trim());
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent
      class="w-[min(380px,calc(100vw-48px))] gap-1.5 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
      :show-close-button="false"
    >
      <form class="contents" @submit.prevent="submit">
        <DialogTitle class="m-0 text-[14px] font-semibold text-[var(--color-txt-strong)]">
          重命名
        </DialogTitle>
        <DialogDescription
          class="m-0 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        >
          {{ path }}
        </DialogDescription>
        <Input ref="inputRef" v-model="value" class="mt-1.5 h-8" />
        <div class="mt-2 flex justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            :disabled="pending"
            @click="emit('update:open', false)"
          >
            取消
          </Button>
          <Button size="sm" :disabled="pending || !valid()" @click="submit">重命名</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
