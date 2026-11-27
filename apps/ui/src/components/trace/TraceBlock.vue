<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";

/** 轨迹详情块：标题 + 复制 + 等宽正文（Nomi 的 Block）；inline 时只渲染复制按钮 */
const props = withDefaults(defineProps<{ label: string; text?: string; inline?: boolean }>(), {
  text: undefined,
  inline: false,
});

const { t } = useI18n();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function copy() {
  void navigator.clipboard
    ?.writeText(props.text ?? "")
    .then(() => {
      copied.value = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        copied.value = false;
      }, 1500);
    })
    .catch(() => undefined);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Button v-if="props.inline" variant="ghost" size="xs" :disabled="!props.text" @click="copy">
    {{ copied ? t("trace.copied") : props.label }}
  </Button>
  <section v-else-if="props.text" class="trace-block">
    <header class="trace-block-head">
      <span>{{ props.label }}</span>
      <Button variant="ghost" size="xs" @click="copy">
        {{ copied ? t("trace.copied") : t("trace.copy") }}
      </Button>
    </header>
    <pre class="trace-pre">{{ props.text }}</pre>
  </section>
</template>

<style scoped>
.trace-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.trace-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--color-dim);
}

.trace-pre {
  margin: 0;
  max-height: 300px;
  overflow: auto;
  padding: 8px;
  border-radius: var(--radius-sm);
  background: var(--color-sunken);
  color: var(--color-txt);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
