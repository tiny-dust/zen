<script setup lang="ts">
import { IconPhotoPlus as ImagePlus, IconLoader2 as LoaderCircle, IconTrash as Trash2, IconX as X } from "@tabler/icons-vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { GeneratedImageRecord, ImageSize, ProviderSummary } from "@zen/shared";
import { IMAGE_SIZES } from "@zen/shared";

/**
 * 生图 + 素材库弹层：
 * - 左侧填写描述并生成（模型必须是已启用、带 imageEdit 能力的 API Key 模型）；
 * - 右侧列出 ~/.zen/images 里的历史素材，可预览、插入当前会话附件、删除（二次确认）。
 * 图标/配色沿用面板 token，不新增主题值。
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  insert: [record: GeneratedImageRecord];
}>();

const { t } = useI18n();
const prompt = ref("");
const size = ref<ImageSize>("1024x1024");
const selection = ref("");
const providers = ref<ProviderSummary[]>([]);
const records = ref<GeneratedImageRecord[]>([]);
const previews = ref<Record<string, string>>({});
const selectedId = ref("");
const confirmingId = ref("");
const generating = ref(false);
const loading = ref(false);
const error = ref("");

/** 可生图模型：与设置页宠物精灵同一套筛选条件（认证方式 / 协议 / imageEdit） */
const models = computed(() =>
  providers.value.flatMap((provider) =>
    provider.enabled && provider.hasApiKey && (!provider.authMode || provider.authMode === "api-key")
    && (provider.protocol === "openai-chat" || provider.protocol === "openai-responses")
      ? provider.models
        .filter((model) => model.enabled && model.capabilities?.imageEdit)
        .map((model) => ({ value: JSON.stringify([provider.id, model.id]), label: `${provider.name} · ${model.name}` }))
      : [],
  ),
);

const selectedRecord = computed(() => records.value.find((item) => item.id === selectedId.value) ?? null);

async function loadModels() {
  try {
    providers.value = (await window.zen!.models.list()) as ProviderSummary[];
    if (!selection.value) {
      selection.value = models.value[0]?.value ?? "";
    }
  } catch {
    // 模型列表读不到时保持空态，由界面提示「未配置」
  }
}

async function loadPreview(id: string) {
  if (previews.value[id]) {
    return;
  }
  const result = await window.zen!.images.read(id).catch(() => null);
  if (result?.ok && result.dataUrl) {
    previews.value = { ...previews.value, [id]: result.dataUrl };
  }
}

async function loadLibrary() {
  loading.value = true;
  try {
    records.value = await window.zen!.images.list();
    if (!selectedId.value || !records.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = records.value[0]?.id ?? "";
    }
    await Promise.all(records.value.slice(0, 12).map((item) => loadPreview(item.id)));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("chat.imageStudio.loadFailed");
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }
    error.value = "";
    void loadModels();
    void loadLibrary();
  },
  { immediate: true },
);

/** 弹层关闭时收掉进行中的生成，避免后台继续扣费用 */
watch(
  () => props.open,
  (open) => {
    if (!open && generating.value) {
      void window.zen!.images.cancel();
    }
  },
);

onUnmounted(() => {
  if (generating.value) {
    void window.zen!.images.cancel();
  }
});

async function onGenerate() {
  if (!prompt.value.trim() || generating.value) {
    return;
  }
  const [providerId, modelId] = selection.value ? (JSON.parse(selection.value) as [string, string]) : [];
  if (!providerId || !modelId) {
    error.value = t("chat.imageStudio.noModel");
    return;
  }
  error.value = "";
  generating.value = true;
  try {
    const result = await window.zen!.images.generate({ providerId, modelId, prompt: prompt.value, size: size.value });
    if (!result.ok || !result.record) {
      error.value = result.error || t("chat.imageStudio.generateFailed");
      return;
    }
    prompt.value = "";
    await loadLibrary();
    selectedId.value = result.record.id;
    await loadPreview(result.record.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("chat.imageStudio.generateFailed");
  } finally {
    generating.value = false;
  }
}

async function onCancel() {
  await window.zen!.images.cancel();
}

function onSelect(record: GeneratedImageRecord) {
  selectedId.value = record.id;
  confirmingId.value = "";
  void loadPreview(record.id);
}

async function onDelete(record: GeneratedImageRecord) {
  if (confirmingId.value !== record.id) {
    confirmingId.value = record.id;
    return;
  }
  confirmingId.value = "";
  const result = await window.zen!.images.remove(record.id);
  if (!result.ok) {
    error.value = result.error || t("chat.imageStudio.deleteFailed");
    return;
  }
  const next = { ...previews.value };
  delete next[record.id];
  previews.value = next;
  await loadLibrary();
}

function onInsert(record: GeneratedImageRecord) {
  emit("insert", record);
  emit("update:open", false);
}
</script>

<template>
  <Dialog :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <DialogContent class="max-w-[820px]">
      <DialogHeader>
        <DialogTitle>{{ t("chat.imageStudio.title") }}</DialogTitle>
        <DialogDescription>{{ t("chat.imageStudio.description") }}</DialogDescription>
      </DialogHeader>

      <div class="grid min-h-0 grid-cols-1 gap-4 sm:grid-cols-[260px_1fr]">
        <div class="flex flex-col gap-2">
          <Textarea
            v-model="prompt"
            class="min-h-24 resize-none text-[12px]"
            :placeholder="t('chat.imageStudio.promptPlaceholder')"
            :aria-label="t('chat.imageStudio.promptLabel')"
            maxlength="2000"
          />
          <div class="flex items-center gap-2">
            <Select v-model="selection">
              <SelectTrigger class="h-8 min-w-0 flex-1 text-[12px]" :aria-label="t('chat.imageStudio.modelLabel')">
                <SelectValue :placeholder="t('chat.imageStudio.noModel')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="model in models" :key="model.value" :value="model.value">
                  {{ model.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="size">
              <SelectTrigger class="h-8 w-[104px] flex-none text-[12px]" :aria-label="t('chat.imageStudio.sizeLabel')">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="value in IMAGE_SIZES" :key="value" :value="value">{{ value }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center gap-2">
            <Button class="h-8 flex-1 gap-1.5 text-[12px]" :disabled="generating || !prompt.trim()" @click="onGenerate">
              <LoaderCircle v-if="generating" class="size-3.5 animate-spin" aria-hidden="true" />
              <ImagePlus v-else class="size-3.5" aria-hidden="true" />
              {{ generating ? t("chat.imageStudio.generating") : t("chat.imageStudio.generate") }}
            </Button>
            <Button
              v-if="generating"
              variant="ghost"
              class="h-8 text-[12px]"
              @click="onCancel"
            >
              {{ t("chat.imageStudio.cancel") }}
            </Button>
          </div>
          <p v-if="error" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">{{ error }}</p>
          <p v-else-if="!models.length" class="m-0 text-[11px] text-[var(--color-dim)]">
            {{ t("chat.imageStudio.noModelHint") }}
          </p>
        </div>

        <div class="flex min-h-0 flex-col gap-2">
          <div v-if="selectedRecord" class="flex min-h-[160px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] p-2">
            <img
              v-if="previews[selectedRecord.id]"
              :src="previews[selectedRecord.id]"
              :alt="selectedRecord.prompt"
              class="max-h-[240px] w-auto max-w-full rounded-[var(--radius-xs)] object-contain"
            />
            <span v-else class="text-[11px] text-[var(--color-dim)]">{{ t("chat.imageStudio.previewPending") }}</span>
          </div>
          <p v-if="selectedRecord" class="m-0 line-clamp-2 text-[var(--font-size-xs)] text-[var(--color-mut)]">
            {{ selectedRecord.prompt }}
          </p>

          <div
            v-if="records.length"
            class="grid max-h-[210px] grid-cols-3 gap-1.5 overflow-y-auto [scrollbar-width:thin]"
          >
            <div v-for="record in records" :key="record.id" class="group relative aspect-square">
              <button
                type="button"
                class="size-full overflow-hidden rounded-[var(--radius-xs)] border transition-colors"
                :class="
                  record.id === selectedId
                    ? 'border-[var(--color-accent)]'
                    : 'border-[var(--color-line-soft)] hover:border-[var(--color-line)]'
                "
                :aria-label="record.prompt"
                :aria-pressed="record.id === selectedId"
                @click="onSelect(record)"
              >
                <img
                  v-if="previews[record.id]"
                  :src="previews[record.id]"
                  :alt="record.prompt"
                  class="size-full object-cover"
                  loading="lazy"
                />
                <span v-else class="flex size-full items-center justify-center text-[11px] text-[var(--color-dim)]">
                  {{ t("chat.imageStudio.previewPending") }}
                </span>
              </button>
              <!-- 删除是独立按钮：键盘可聚焦，二次确认期间常显 -->
              <button
                type="button"
                class="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-[var(--color-main-bg)]/85 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100"
                :class="confirmingId === record.id ? 'opacity-100' : ''"
                :aria-label="t('chat.imageStudio.delete', { name: record.prompt })"
                @click.stop="onDelete(record)"
              >
                <Trash2
                  class="size-3"
                  :class="confirmingId === record.id ? 'text-[var(--color-del)]' : 'text-[var(--color-mut)]'"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <p v-else-if="!loading" class="m-0 py-6 text-center text-[12px] text-[var(--color-dim)]">
            {{ t("chat.imageStudio.empty") }}
          </p>

          <div v-if="confirmingId" class="flex items-center gap-2 text-[11px] text-[var(--color-mut)]" role="alert">
            <span>{{ t("chat.imageStudio.deleteConfirm") }}</span>
            <Button variant="ghost" class="h-6 px-2 text-[11px]" @click="confirmingId = ''">
              <X class="mr-1 size-3" aria-hidden="true" />
              {{ t("chat.imageStudio.deleteCancel") }}
            </Button>
          </div>

          <div v-if="selectedRecord" class="mt-auto flex justify-end">
            <Button class="h-8 text-[12px]" @click="onInsert(selectedRecord)">
              {{ t("chat.imageStudio.insert") }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
