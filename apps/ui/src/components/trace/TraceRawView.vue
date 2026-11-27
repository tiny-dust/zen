<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";

import { prettyJson } from "@/lib/trace/format";

import { Button } from "@/components/ui/button";

import TraceBlock from "./TraceBlock.vue";

/** 原始事件：会话消息与分段的原始 JSON（Nomi 的 Raw events 视图） */
const props = defineProps<{ messages: readonly unknown[] }>();

const { t } = useI18n();

/** 原始 JSON 可能十几 MB：整段塞进 <pre> 会让样式计算与绘制卡住几秒 */
const RAW_LIMIT = 256_000;

/**
 * 只渲染前 256KB：逐条消息序列化累计到上限就停，
 * 不再先拼出 12MB 的大字符串再切（那样光 stringify 就够一次掉帧）。
 */
const preview = computed(() => {
  const pieces: string[] = [];
  let size = 0;
  let truncated = false;
  for (const message of props.messages) {
    const piece = JSON.stringify(message, null, 2);
    if (size + piece.length > RAW_LIMIT) {
      pieces.push(piece.slice(0, RAW_LIMIT - size));
      truncated = true;
      break;
    }
    pieces.push(piece);
    size += piece.length;
  }
  return { text: pieces.join(",\n"), truncated };
});

const shown = computed(() => preview.value.text);
const truncated = computed(() => preview.value.truncated);

/** 完整 JSON 只在点「复制全部」时才算：那是用户明确要求的动作，慢一点无所谓 */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function copyAll() {
  void navigator.clipboard
    ?.writeText(prettyJson(props.messages))
    .then(() => {
      copied.value = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied.value = false;
      }, 1500);
    })
    .catch(() => undefined);
}

onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <div class="raw-pane">
    <div class="raw-bar">
      <p class="raw-hint">{{ t("trace.rawHint") }}</p>
      <Button v-if="truncated" variant="ghost" size="xs" @click="copyAll">
        {{ copied ? t("trace.copied") : t("trace.rawCopyAll") }}
      </Button>
    </div>
    <p v-if="truncated" class="raw-hint">
      {{ t("trace.rawTruncated") }}
    </p>
    <TraceBlock :label="t('trace.tabRaw')" :text="shown" class="raw-block" />
  </div>
</template>

<style scoped>
.raw-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
  padding: 12px;
}

.raw-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-dim);
}

.raw-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.raw-block {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.raw-block :deep(.trace-pre) {
  max-height: none;
  height: 100%;
}
</style>
