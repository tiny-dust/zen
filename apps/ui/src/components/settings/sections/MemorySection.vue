<script setup lang="ts">
import { Brain, ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Sparkles, X } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import SectionHeader from "@/components/settings/sections/SectionHeader.vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMORY_CATEGORIES } from "@zen/shared";

import type {
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemoryView,
} from "@zen/shared";

/**
 * 记忆：设备环境快照 + 按分类归档的设备备注 + 用户习惯。
 *
 * 设备备注数量会长期增长，像技能一样「索引 + 按需读取」：
 * 主进程只在视图里给分类索引（项目 / 硬件 / 环境变量 / 工具链 / 其他 + 条数与摘要），
 * 展开某一类时才通过 IPC 读取该类正文；会话提示词里同样只注入索引。
 * 整固 = 模型合并去重 + diff 审阅后原子替换。
 */
const { t } = useI18n();

const memory = ref<MemoryView | null>(null);
const memoryBusy = ref(false);
/** 两个备注范围的草稿输入（按 scope 索引） */
const noteDrafts = reactive<Record<MemoryScope, string>>({ device: "", user: "" });
/** 设备备注新增时选的分类（缺省 other，也可不改由主进程按内容推断？这里显式选更可控） */
const draftCategory = ref<MemoryCategory>("other");
/** 展开中的设备备注分类 + 该分类已加载的正文 */
const expandedCategory = ref<MemoryCategory | null>(null);
const categoryNotes = ref<MemoryNote[]>([]);
const categoryLoading = ref(false);
const pendingDelete = ref<{ scope: MemoryScope; id: string; text: string } | null>(null);
const deleteBusy = ref(false);

// 整固：预览（模型算 diff）→ Dialog 审阅 → 确认后原子写入；失败/取消不动原始数据
const consolidateScope = ref<MemoryScope | null>(null);
const previewResult = ref<MemoryConsolidationResult | null>(null);
const previewError = ref("");
const previewBusy = ref(false);
const applyBusy = ref(false);

const deviceTools = computed(() => Object.entries(memory.value?.device?.tools ?? {}));
/** 设备备注分类索引（不含正文） */
const deviceGroups = computed(() => memory.value?.device?.groups ?? []);
const deviceTotal = computed(() =>
  deviceGroups.value.reduce((sum, group) => sum + group.count, 0),
);
const userNoteList = computed(() => memory.value?.user?.notes ?? []);
const consolidateScopeLabel = computed(() =>
  consolidateScope.value === "user"
    ? t("settings.agent.userHabits")
    : t("settings.agent.deviceNotes"),
);

const CATEGORY_LABELS = computed<Record<MemoryCategory, string>>(() => ({
  project: t("settings.agent.memoryCategories.project"),
  hardware: t("settings.agent.memoryCategories.hardware"),
  env: t("settings.agent.memoryCategories.env"),
  tool: t("settings.agent.memoryCategories.tool"),
  other: t("settings.agent.memoryCategories.other"),
}));

function noteStats(notes: Array<{ text: string }>): { count: number; chars: number } {
  return {
    count: notes.length,
    chars: notes.reduce((total, note) => total + note.text.length, 0),
  };
}

async function loadMemory() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memory.value = await zen.memory.get();
}

/** 展开/收起某类设备备注：展开时才按需读取该类正文 */
async function toggleCategory(category: MemoryCategory) {
  if (expandedCategory.value === category) {
    expandedCategory.value = null;
    categoryNotes.value = [];
    return;
  }
  expandedCategory.value = category;
  await loadCategory(category);
}

async function loadCategory(category: MemoryCategory) {
  const zen = window.zen;
  if (!zen?.memory || !zen.memory.notes) {
    return;
  }
  categoryLoading.value = true;
  try {
    categoryNotes.value = await zen.memory.notes("device", category);
  } finally {
    categoryLoading.value = false;
  }
}

onMounted(() => {
  void loadMemory();
});

async function addNote(scope: MemoryScope) {
  const zen = window.zen;
  const text = noteDrafts[scope].trim();
  if (!zen?.memory || !text) {
    return;
  }
  memory.value = await zen.memory.addNote(
    scope,
    text,
    scope === "device" ? draftCategory.value : undefined,
  );
  noteDrafts[scope] = "";
  if (scope === "device") {
    // 新备注可能落在任意分类：索引已刷新，展开中的分类重新读取正文
    if (expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  }
}

async function removeNote() {
  const zen = window.zen;
  const target = pendingDelete.value;
  if (!zen?.memory || !target) {
    return;
  }
  deleteBusy.value = true;
  try {
    memory.value = await zen.memory.removeNote(target.scope, target.id);
    pendingDelete.value = null;
    if (target.scope === "device" && expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  } finally {
    deleteBusy.value = false;
  }
}

async function recollect() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memoryBusy.value = true;
  try {
    memory.value = await zen.memory.collect();
    if (expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  } finally {
    memoryBusy.value = false;
  }
}

async function startConsolidate(scope: MemoryScope) {
  const zen = window.zen;
  if (!zen?.memory || previewBusy.value) {
    return;
  }
  consolidateScope.value = scope;
  previewResult.value = null;
  previewError.value = "";
  previewBusy.value = true;
  try {
    const result = await zen.memory.consolidatePreview(scope);
    if (result.ok) {
      previewResult.value = result;
    } else {
      previewError.value = result.error ?? "";
    }
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : String(error);
  } finally {
    previewBusy.value = false;
  }
}

async function applyConsolidated() {
  const zen = window.zen;
  const scope = consolidateScope.value;
  const result = previewResult.value;
  if (!zen?.memory || !scope || !result) {
    return;
  }
  applyBusy.value = true;
  try {
    // zen-005：ref 内对象过桥前先序列化成纯值
    memory.value = await zen.memory.applyConsolidation(
      scope,
      JSON.parse(JSON.stringify(result.after)) as Array<{
        id: string;
        text: string;
        createdAt: number;
      }>,
    );
    consolidateScope.value = null;
    previewResult.value = null;
    previewError.value = "";
    if (scope === "device") {
      expandedCategory.value = null;
      categoryNotes.value = [];
    }
  } finally {
    applyBusy.value = false;
  }
}

function closeConsolidate() {
  if (previewBusy.value || applyBusy.value) {
    return;
  }
  consolidateScope.value = null;
  previewResult.value = null;
  previewError.value = "";
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
</script>

<template>
  <section id="set-agent-memory" class="flex flex-col gap-3 scroll-mt-2">
    <SectionHeader
      :icon="Brain"
      :title="t('settings.agent.memoryTitle')"
      :desc="t('settings.agent.memoryDesc')"
    />

    <!-- 设备环境：只读快照，元信息按字段行对齐 -->
    <div
      v-if="memory?.device"
      class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]"
    >
      <header class="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
        <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ t("settings.agent.deviceSnapshot") }}
        </span>
        <span class="flex-none text-[11px] text-[var(--color-dim)]">
          {{ t("settings.agent.collectedAt", { time: formatTime(memory.device.collectedAt) }) }}
        </span>
        <Button variant="outline" size="sm" :disabled="memoryBusy" @click="recollect">
          <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.agent.recollect") }}
        </Button>
      </header>
      <div class="flex flex-col px-3 py-1.5">
        <div class="field-row">
          <span class="field-row-label">{{ t("settings.agent.metaSystem") }}</span>
          <span class="field-row-value">{{ memory.device.platform }} {{ memory.device.arch }}</span>
        </div>
        <div class="field-row">
          <span class="field-row-label">{{ t("settings.agent.metaShell") }}</span>
          <span class="field-row-value">{{ memory.device.shell }}</span>
        </div>
        <div v-if="memory.device.timezone" class="field-row">
          <span class="field-row-label">{{ t("settings.agent.metaTimezone") }}</span>
          <span class="field-row-value">
            {{ memory.device.timezone }}
            <template v-if="memory.device.locale"> · {{ memory.device.locale }}</template>
          </span>
        </div>
        <div class="field-row">
          <span class="field-row-label">{{ t("settings.agent.metaHome") }}</span>
          <span class="field-row-value">{{ memory.device.home }}</span>
        </div>
        <div v-if="deviceTools.length" class="field-row">
          <span class="field-row-label">{{ t("settings.agent.metaTools") }}</span>
          <div class="flex flex-wrap gap-1.5 pt-1">
            <span
              v-for="[name, path] in deviceTools"
              :key="name"
              class="inline-flex max-w-full items-baseline gap-1 rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-mut)]"
              :title="`${name} = ${path}`"
            >
              <span class="font-[family-name:var(--font-mono)] text-[var(--color-txt)]">{{ name }}</span>
              <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ path }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备备注：分类索引（数量 + 摘要），展开某类才读取正文 -->
    <div class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]">
      <header class="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
        <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ t("settings.agent.deviceNotes") }}
        </span>
        <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">
          {{ t("settings.agent.deviceNotesCount", { count: deviceTotal, categories: deviceGroups.length }) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="previewBusy || !deviceTotal"
          @click="startConsolidate('device')"
        >
          <Sparkles :size="13" data-icon="inline-start" />{{ t("settings.agent.consolidate") }}
        </Button>
      </header>

      <p class="m-0 px-3 pb-1 pt-2 text-[11px] leading-relaxed text-[var(--color-mut)]">
        {{ t("settings.agent.deviceNotesIndexHint") }}
      </p>

      <p v-if="!deviceGroups.length" class="m-0 px-3 py-1.5 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.agent.deviceNotesEmpty") }}
      </p>
      <div v-else class="flex flex-col px-2 pb-1">
        <div v-for="group in deviceGroups" :key="group.category" class="flex flex-col">
          <Button
            variant="ghost"
            class="h-auto min-h-8 w-full items-center justify-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left font-normal hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]"
            :aria-expanded="expandedCategory === group.category"
            @click="toggleCategory(group.category)"
          >
            <ChevronDown
              v-if="expandedCategory === group.category"
              class="size-3.5 flex-none text-[var(--color-mut)]"
              aria-hidden="true"
            />
            <ChevronRight v-else class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
            <span class="flex-none text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ CATEGORY_LABELS[group.category] }}
            </span>
            <span class="inline-flex h-4 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-mut)]">
              {{ group.count }}
            </span>
            <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
              {{ group.previews[0] }}{{ group.count > 1 ? " …" : "" }}
            </span>
          </Button>
          <div
            v-if="expandedCategory === group.category"
            class="ml-[18px] flex flex-col gap-0.5 border-l border-[var(--color-line-soft)] pb-1.5 pl-2"
          >
            <p v-if="categoryLoading" class="m-0 flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--color-dim)]">
              <Loader2 class="size-3 animate-spin" aria-hidden="true" />
              {{ t("settings.agent.notesLoading") }}
            </p>
            <div
              v-for="note in categoryNotes"
              v-else
              :key="note.id"
              class="group/note flex items-start gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-[11px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
            >
              <span class="mt-1 size-1 flex-none rounded-full bg-[var(--color-dim)]" aria-hidden="true" />
              <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
              <DangerIconButton
                :label="t('settings.agent.deleteDeviceNoteAria')"
                class="opacity-0 group-hover/note:opacity-100"
                @click="pendingDelete = { scope: 'device', id: note.id, text: note.text }"
              >
                <X :size="13" />
              </DangerIconButton>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5 border-t border-[var(--color-line-soft)] px-3 py-2">
        <Select v-model="draftCategory">
          <SelectTrigger size="sm" class="h-8 w-[92px] flex-none text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="category in MEMORY_CATEGORIES" :key="category" :value="category">
                {{ CATEGORY_LABELS[category] }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          v-model="noteDrafts.device"
          variant="ghost"
          class="h-8 flex-1 text-[12px]"
          :placeholder="t('settings.agent.deviceNotePlaceholder')"
          @keydown.enter.prevent="addNote('device')"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
          :aria-label="t('settings.agent.addDeviceNoteAria')"
          :disabled="!noteDrafts.device.trim()"
          @click="addNote('device')"
        >
          <Plus :size="14" />
        </Button>
      </div>
    </div>

    <!-- 用户习惯：数量少且总是随会话注入，保持平铺列表 -->
    <div class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]">
      <header class="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
        <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ t("settings.agent.userHabits") }}
        </span>
        <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">
          {{ t("settings.agent.consolidateStats", noteStats(userNoteList)) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="previewBusy || !userNoteList.length"
          @click="startConsolidate('user')"
        >
          <Sparkles :size="13" data-icon="inline-start" />{{ t("settings.agent.consolidate") }}
        </Button>
      </header>

      <p class="m-0 px-3 pt-2 text-[11px] leading-relaxed text-[var(--color-mut)]">
        {{ t("settings.agent.userHabitsHint") }}
      </p>
      <p v-if="!userNoteList.length" class="m-0 px-3 py-1.5 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.agent.userHabitsEmpty") }}
      </p>
      <ul v-else class="m-0 flex list-none flex-col gap-0.5 px-3 py-1.5">
        <li
          v-for="note in userNoteList"
          :key="note.id"
          class="group/note flex items-start gap-2 rounded-[var(--radius-sm)] py-0.5 pl-1 pr-0.5 text-[11px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
        >
          <span class="mt-1 size-1 flex-none rounded-full bg-[var(--color-dim)]" aria-hidden="true" />
          <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
          <DangerIconButton
            :label="t('settings.agent.deleteUserNoteAria')"
            class="opacity-0 group-hover/note:opacity-100"
            @click="pendingDelete = { scope: 'user', id: note.id, text: note.text }"
          >
            <X :size="13" />
          </DangerIconButton>
        </li>
      </ul>

      <div class="flex items-center gap-1.5 border-t border-[var(--color-line-soft)] px-3 py-2">
        <Input
          v-model="noteDrafts.user"
          variant="ghost"
          class="h-8 flex-1 text-[12px]"
          :placeholder="t('settings.agent.userNotePlaceholder')"
          @keydown.enter.prevent="addNote('user')"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
          :aria-label="t('settings.agent.addUserNoteAria')"
          :disabled="!noteDrafts.user.trim()"
          @click="addNote('user')"
        >
          <Plus :size="14" />
        </Button>
      </div>
    </div>

    <!-- 整固 diff 审阅：左当前 / 右整固后，两栏各自内滚不串扰（§1.2）；确认前不落盘 -->
    <Dialog
      :open="consolidateScope != null"
      @update:open="(next) => { if (!next) closeConsolidate(); }"
    >
      <DialogContent
        class="w-[min(720px,calc(100vw-48px))] gap-3 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
        data-large-panel="true"
      >
        <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
          {{ t("settings.agent.consolidateTitle") }}
        </DialogTitle>
        <DialogDescription class="text-[12px] leading-normal text-[var(--color-mut)]">
          {{ t("settings.agent.consolidateDesc", { scope: consolidateScopeLabel }) }}
        </DialogDescription>

        <!-- 失败：提示错误，可关闭重试；原始数据未动 -->
        <p v-if="previewError" class="m-0 text-[12px] leading-normal text-[var(--color-err)]">
          {{ t("settings.agent.consolidateFailed", { error: previewError }) }}
        </p>
        <!-- 生成中 -->
        <p v-else-if="previewBusy" class="m-0 text-[12px] text-[var(--color-dim)]">
          {{ t("settings.agent.consolidateLoading") }}
        </p>
        <!-- diff 主体 -->
        <div v-else-if="previewResult" class="grid grid-cols-2 gap-3">
          <div class="flex min-h-0 max-h-72 flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] p-2">
            <span class="text-[11px] font-medium text-[var(--color-mut)]">
              {{ t("settings.agent.consolidateBefore", { count: previewResult.before.length }) }}
            </span>
            <ul class="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto overscroll-contain p-0">
              <li
                v-for="note in previewResult.before"
                :key="note.id"
                class="break-words text-[11px] leading-snug text-[var(--color-dim)]"
              >
                {{ note.text }}
              </li>
            </ul>
          </div>
          <div class="flex min-h-0 max-h-72 flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] p-2">
            <span class="text-[11px] font-medium text-[var(--color-mut)]">
              {{ t("settings.agent.consolidateAfter", { count: previewResult.after.length }) }}
            </span>
            <ul class="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto overscroll-contain p-0">
              <li
                v-for="note in previewResult.after"
                :key="note.id"
                class="break-words text-[11px] leading-snug text-[var(--color-txt)]"
              >
                {{ note.text }}
              </li>
            </ul>
          </div>
        </div>
        <p
          v-if="previewResult && !previewResult.changedCount"
          class="m-0 text-[11px] text-[var(--color-dim)]"
        >
          {{ t("settings.agent.consolidateNoChange") }}
        </p>

        <div class="flex justify-end gap-1.5">
          <Button
            variant="default"
            size="sm"
            :disabled="applyBusy || !previewResult || !previewResult.changedCount"
            @click="applyConsolidated"
          >
            {{ t("settings.agent.consolidateApply") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="previewBusy || applyBusy"
            @click="closeConsolidate"
          >
            {{ t("common.cancel") }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 删除备注二次确认（会落库的删除） -->
    <ConfirmDialog
      :open="pendingDelete != null"
      :title="pendingDelete?.scope === 'user' ? t('settings.agent.deleteUserNoteTitle') : t('settings.agent.deleteDeviceNoteTitle')"
      :description="t('settings.agent.deleteNoteDesc', { text: pendingDelete?.text ?? '' })"
      :confirm-label="t('common.delete')"
      :pending="deleteBusy"
      @update:open="(next) => { if (!next) pendingDelete = null; }"
      @confirm="removeNote"
    />
  </section>
</template>
