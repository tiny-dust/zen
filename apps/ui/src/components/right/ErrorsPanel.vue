<script setup lang="ts">
import { Bug, ChevronDown, ChevronRight, LoaderCircle, RefreshCw, Trash2, Wrench } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useErrorsStore } from "@/stores/errors";
import { cn } from "@/lib/utils";

import type { ErrorReportRecord } from "@zen/shared";

/**
 * 右栏异常中心：列出主进程 + 渲染层自动收集的运行时报错（最近发生在前），
 * 单条可本地分析（软件相关 / 环境相关）与展开堆栈；软件相关条目一键进入
 * 修复会话；清空与单条删除均为落库删除，先过二次确认。
 */
const { t } = useI18n();
const store = useErrorsStore();
const { reports, analysisMap, analyzing, loaded } = storeToRefs(store);

onMounted(() => {
  store.init();
  void store.refresh();
});

/** 堆栈展开态（按记录 id） */
const expandedIds = ref<Record<string, boolean>>({});

function toggleStack(id: string) {
  expandedIds.value[id] = !expandedIds.value[id];
}

/** 清空/单条删除的二次确认 */
const confirmClearOpen = ref(false);
const pendingDelete = ref<ErrorReportRecord | null>(null);

async function onClearAll() {
  confirmClearOpen.value = false;
  await store.clearAll();
}

async function onRemoveOne() {
  const record = pendingDelete.value;
  pendingDelete.value = null;
  if (record) {
    await store.removeOne(record.id);
  }
}

function onAnalyze(record: ErrorReportRecord) {
  void store.analyze(record.id);
}

function onFix(record: ErrorReportRecord) {
  void store.startFix(record);
}

function sourceLabel(source: ErrorReportRecord["source"]): string {
  return source === "main" ? t("errors.sourceMain") : t("errors.sourceRenderer");
}

function kindLabel(kind: ErrorReportRecord["kind"]): string {
  return t(`errors.kind.${kind}`);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 跨周回落到月日 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return t("errors.timeJustNow");
  }
  if (diff < 3_600_000) {
    return t("errors.timeMinutesAgo", { n: Math.floor(diff / 60_000) });
  }
  if (diff < 86_400_000) {
    return t("errors.timeHoursAgo", { n: Math.floor(diff / 3_600_000) });
  }
  if (diff < 7 * 86_400_000) {
    return t("errors.timeDaysAgo", { n: Math.floor(diff / 86_400_000) });
  }
  const date = new Date(ts);
  return t("errors.timeDate", { m: date.getMonth() + 1, d: date.getDate() });
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" :aria-label="t('app.panel.errors')">
    <!-- 顶部：说明 + 刷新 / 清空 -->
    <div class="flex flex-none items-center gap-1 px-1">
      <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-mut)]">
        {{ t("errors.description") }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('errors.refresh')"
        :title="t('errors.refresh')"
        @click="void store.refresh()"
      >
        <RefreshCw :class="!loaded ? 'animate-spin' : ''" />
      </Button>
      <Button
        v-if="reports.length"
        variant="ghost"
        size="icon-xs"
        class="text-[var(--color-del)] hover:text-[var(--color-danger-fg)]!"
        :aria-label="t('errors.clearAll')"
        :title="t('errors.clearAll')"
        @click="confirmClearOpen = true"
      >
        <Trash2 />
      </Button>
    </div>

    <!-- 列表 / 空态 -->
    <div class="min-h-0 flex-1 overflow-auto px-1">
      <div
        v-if="!reports.length"
        class="flex h-full flex-col items-center justify-center gap-1.5 text-center"
      >
        <Bug class="size-5 text-[var(--color-dim)]" aria-hidden="true" />
        <p class="m-0 text-[13px] text-[var(--color-txt)]">{{ t("errors.emptyTitle") }}</p>
        <p class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("errors.emptyHint") }}</p>
      </div>

      <div v-else class="flex flex-col gap-2">
        <article
          v-for="record in reports"
          :key="record.id"
          class="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] p-2.5"
        >
          <!-- 头行：来源 / 类型 / 次数 / 相对时间 -->
          <div class="flex items-center gap-1.5 text-[11px]">
            <Badge variant="outline" class="h-5 flex-none px-1.5 text-[10px] font-normal">
              {{ sourceLabel(record.source) }}
            </Badge>
            <span class="flex-none text-[var(--color-mut)]">{{ kindLabel(record.kind) }}</span>
            <span
              v-if="record.count > 1"
              class="flex-none rounded-full bg-[var(--color-side-sel)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--color-txt)]"
            >
              {{ t("errors.countTimes", { n: record.count }) }}
            </span>
            <span class="ml-auto min-w-0 flex-none text-[var(--color-dim)]">
              {{ relativeTime(record.lastSeenAt) }}
            </span>
          </div>

          <p class="m-0 truncate text-[12px] text-[var(--color-txt-strong)]" :title="record.message">
            {{ record.message }}
          </p>

          <!-- 操作行：分析 / 修复（仅软件相关）/ 删除 / 展开堆栈 -->
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              class="h-6 px-1.5 text-[11px] font-normal"
              :disabled="!!analyzing[record.id]"
              @click="onAnalyze(record)"
            >
              <LoaderCircle v-if="analyzing[record.id]" class="animate-spin" aria-hidden="true" />
              {{ analyzing[record.id] ? t("errors.analyzing") : t("errors.analyze") }}
            </Button>
            <Button
              v-if="analysisMap[record.id]?.softwareRelated"
              variant="ghost"
              size="xs"
              class="h-6 px-1.5 text-[11px] font-normal text-[var(--color-accent)]"
              @click="onFix(record)"
            >
              <Wrench aria-hidden="true" />
              {{ t("errors.fix") }}
            </Button>
            <DangerIconButton
              :label="t('common.delete')"
              @click="pendingDelete = record"
            >
              <Trash2 class="size-3.5" />
            </DangerIconButton>
            <Button
              v-if="record.stack"
              variant="ghost"
              size="icon-xs"
              class="ml-auto text-[var(--color-dim)] hover:text-[var(--color-txt)]"
              :aria-label="expandedIds[record.id] ? t('errors.hideStack') : t('errors.showStack')"
              :title="expandedIds[record.id] ? t('errors.hideStack') : t('errors.showStack')"
              @click="toggleStack(record.id)"
            >
              <ChevronDown v-if="expandedIds[record.id]" />
              <ChevronRight v-else />
            </Button>
          </div>

          <!-- 分析结果 inline：软件相关 = 醒目；环境相关 = 中性 -->
          <div
            v-if="analysisMap[record.id]"
            class="flex items-start gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px]"
            :class="cn(
              analysisMap[record.id]!.softwareRelated
                ? 'bg-[var(--color-notice-danger-bg)] text-[var(--color-danger-fg)]'
                : 'bg-[var(--color-side)] text-[var(--color-mut)]',
            )"
          >
            <Badge
              :variant="analysisMap[record.id]!.softwareRelated ? 'destructive' : 'secondary'"
              class="h-5 flex-none px-1.5 text-[10px] font-normal"
            >
              {{
                analysisMap[record.id]!.softwareRelated
                  ? t("errors.softwareRelated")
                  : t("errors.environmentRelated")
              }}
            </Badge>
            <span class="min-w-0 flex-1 leading-relaxed">{{ analysisMap[record.id]!.reason }}</span>
            <span class="flex-none text-[10px] opacity-70">
              {{
                analysisMap[record.id]!.confidence === "high"
                  ? t("errors.confidenceHigh")
                  : t("errors.confidenceLow")
              }}
            </span>
          </div>

          <!-- 完整堆栈：可展开，限高滚动 -->
          <pre
            v-if="expandedIds[record.id] && record.stack"
            class="m-0 max-h-40 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-sunken)] p-2 font-[family-name:var(--font-mono)] text-[10px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-mut)]"
          >{{ record.stack }}</pre>
        </article>
      </div>
    </div>

    <!-- 清空 / 删除二次确认（落库删除） -->
    <ConfirmDialog
      :open="confirmClearOpen"
      :title="t('errors.clearTitle')"
      :description="t('errors.clearDesc', { n: reports.length })"
      :confirm-label="t('errors.clearConfirm')"
      @update:open="(next: boolean) => (confirmClearOpen = next)"
      @confirm="onClearAll"
    />
    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('errors.deleteTitle')"
      :description="t('errors.deleteDesc', { message: pendingDelete?.message ?? '' })"
      :confirm-label="t('common.delete')"
      @update:open="(next: boolean) => !next && (pendingDelete = null)"
      @confirm="onRemoveOne"
    />
  </div>
</template>
