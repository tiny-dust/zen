<script setup lang="ts">
import { ArrowRight, Check, History, Search, Sparkles } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { classes } from "rattail";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";

defineProps<{
  /** 小屏底栏：只显示厂商 icon，完整名称进 title */
  compact?: boolean;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const modelsStore = useModelsStore();
const settingsStore = useSettingsStore();
const { providers, autoRoute, lastRouting } = storeToRefs(modelsStore);
// 会话级模型覆盖与阶段覆盖都在 chat store：切换只影响当前会话
const { effectiveSelection, planModel, actModel } = storeToRefs(chatStore);

const open = ref(false);
const query = ref("");
/** 模型 / 计划+执行 / 子代理 / 外部 agent 共用同一个弹层；计划与执行在同一 tab 内切换 */
const activeTab = ref<"model" | "phases" | "sub" | "external">("model");
/** 「计划 / 执行」tab 内当前正在编辑的阶段 */
const editingPhase = ref<"plan" | "act">("plan");
const activeProviderId = ref<string | "recent" | null>(null);
const recentKeys = ref<string[]>([]);
const rootEl = ref<HTMLElement | null>(null);
const searchEl = ref<InstanceType<typeof Input> | null>(null);
/** 弹层向上展开：按触发器到窗口顶部的距离限制高度，短窗口下也不溢出画面 */
const maxHeight = ref(0);

const tabs = computed(() => [
  { id: "model" as const, label: t("chat.model.tabModel") },
  { id: "phases" as const, label: t("chat.model.tabPhases") },
  { id: "sub" as const, label: t("chat.model.tabSub") },
  { id: "external" as const, label: t("chat.model.tabExternal") },
]);

/** 当前正在编辑的阶段；null = 选择会话模型（模型/子代理/外部 tab） */
const activePhase = computed<"plan" | "act" | null>(() =>
  activeTab.value === "phases" ? editingPhase.value : null,
);

type PhaseSource = "override" | "default" | "session";

interface PhaseSlot {
  /** 当前阶段生效的模型选择 */
  selection: { providerId: string; modelId: string };
  /** 展示名（模型名，取不到时退回供应商名） */
  label: string;
  /** 供应商名（小屏头像组按它取品牌图标） */
  vendor: string;
  /** 来源：会话覆盖 / 设置页全局默认 / 会话模型 */
  source: PhaseSource;
}

/** 阶段生效模型：会话覆盖 → 设置页阶段默认（仍需启用）→ 会话模型 */
function resolvePhase(phase: "plan" | "act"): PhaseSlot {
  const override = phase === "plan" ? planModel.value : actModel.value;
  const overrideModel =
    override && modelsStore.findEnabledModel(override.providerId, override.modelId);
  if (override && overrideModel) {
    return {
      selection: override,
      label: overrideModel.model.name,
      vendor: overrideModel.provider.name,
      source: "override",
    };
  }
  const phaseDefault = phase === "plan" ? settingsStore.settings.planModel : settingsStore.settings.actModel;
  const defaultModel =
    phaseDefault && modelsStore.findEnabledModel(phaseDefault.providerId, phaseDefault.modelId);
  if (phaseDefault && defaultModel) {
    return {
      selection: phaseDefault,
      label: defaultModel.model.name,
      vendor: defaultModel.provider.name,
      source: "default",
    };
  }
  const session = effectiveSelection.value;
  const sessionModel = modelsStore.findEnabledModel(session.providerId, session.modelId);
  return {
    selection: session,
    label: sessionModel?.model.name ?? "",
    vendor: sessionModel?.provider.name ?? "",
    source: "session",
  };
}

const planSlot = computed(() => resolvePhase("plan"));
const actSlot = computed(() => resolvePhase("act"));
/** 双模型模式：任一阶段有自己的模型（会话覆盖或全局默认），否则就是单模型 */
const dualMode = computed(
  () => planSlot.value.source !== "session" || actSlot.value.source !== "session",
);

/** 触发器展示的模型（单模型模式下与运行一致） */
const displayedModel = computed(() =>
  modelsStore.findEnabledModel(actSlot.value.selection.providerId, actSlot.value.selection.modelId),
);

/** 当前编辑阶段的会话覆盖与全局默认 */
const phaseOverride = computed(() =>
  activePhase.value === "plan" ? planModel.value : activePhase.value === "act" ? actModel.value : null,
);
const globalPhaseDefault = computed(() =>
  activePhase.value === "plan"
    ? settingsStore.settings.planModel ?? null
    : activePhase.value === "act"
      ? settingsStore.settings.actModel ?? null
      : null,
);
const globalPhaseDefaultModel = computed(() => {
  const ref = globalPhaseDefault.value;
  return ref ? modelsStore.findEnabledModel(ref.providerId, ref.modelId) : null;
});
const globalPhaseDefaultLabel = computed(() => {
  const found = globalPhaseDefaultModel.value;
  return found
    ? t("chat.model.providerModel", { provider: found.provider.name, model: found.model.name })
    : t("chat.model.providerModel", {
        provider: globalPhaseDefault.value?.providerId ?? "",
        model: globalPhaseDefault.value?.modelId ?? "",
      });
});

/** 列表当前对比的模型：阶段 tab 用该阶段的生效选择，否则用会话模型 */
const displayedSelection = computed(() =>
  activePhase.value
    ? resolvePhase(activePhase.value).selection
    : { providerId: actSlot.value.selection.providerId, modelId: actSlot.value.selection.modelId },
);

const enabledGroups = computed(() =>
  providers.value
    .map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models.filter((m) => m.enabled),
    }))
    .filter((g) => g.models.length > 0),
);

const allModels = computed(() =>
  enabledGroups.value.flatMap((g) =>
    g.models.map((m) => ({ providerId: g.id, providerName: g.name, model: m })),
  ),
);

const recentModels = computed(() => {
  const map = new Map(
    allModels.value.map((item) => [`${item.providerId}:${item.model.id}`, item]),
  );
  return recentKeys.value
    .map((key) => map.get(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6);
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  let list = allModels.value;
  if (activeProviderId.value && activeProviderId.value !== "recent") {
    list = list.filter((item) => item.providerId === activeProviderId.value);
  } else if (activeProviderId.value === "recent") {
    list = recentModels.value;
  }
  if (!q) {
    return list;
  }
  return list.filter(
    (item) =>
      item.model.name.toLowerCase().includes(q) ||
      item.model.id.toLowerCase().includes(q) ||
      item.providerName.toLowerCase().includes(q),
  );
});

const selectedKey = computed(() => {
  const selected = displayedSelection.value;
  return selected.providerId && selected.modelId ? `${selected.providerId}:${selected.modelId}` : "";
});

function itemKey(providerId: string, modelId: string) {
  return `${providerId}:${modelId}`;
}

function isSelected(providerId: string, modelId: string) {
  // 自动路由模式下唯一选中态挂在「自动」项上（zen-001：同屏不出现两个勾）
  if (activePhase.value) {
    return phaseOverride.value ? selectedKey.value === itemKey(providerId, modelId) : false;
  }
  if (autoRoute.value) return false;
  return selectedKey.value === itemKey(providerId, modelId);
}

/** 该项是否是当前阶段的全局默认（用于「全局默认」来源标注） */
function isPhaseGlobalDefault(providerId: string, modelId: string) {
  const ref = globalPhaseDefault.value;
  return Boolean(ref && ref.providerId === providerId && ref.modelId === modelId);
}

/** 顶部首项：「自动（推荐）」或「跟随全局默认」的选中态 */
const topChoiceSelected = computed(() =>
  activePhase.value ? !phaseOverride.value : autoRoute.value,
);

/** 上次路由理由：规则 id → i18n 文本，多规则以「；」拼接 */
const routingReason = computed(() => {
  const routing = lastRouting.value;
  if (!routing?.rules.length) {
    return "";
  }
  return routing.rules
    .map((rule) => t(`model-routing.modelRouting.rule.${rule}`))
    .filter(Boolean)
    .join(t("model-routing.modelRouting.reasonSeparator"));
});

const sourceLabel = computed(() => ({
  override: t("chat.model.phaseSourceOverride"),
  default: t("chat.model.phaseSourceDefault"),
  session: t("chat.model.phaseSourceSession"),
}));

/** 触发按钮 title：单模型给自动模式理由；双模型给两段完整说明 */
const triggerTitle = computed(() => {
  if (dualMode.value) {
    return t("chat.model.triggerDual", {
      plan: `${planSlot.value.label}（${sourceLabel.value[planSlot.value.source]}）`,
      act: `${actSlot.value.label}（${sourceLabel.value[actSlot.value.source]}）`,
    });
  }
  const modelName = displayedModel.value?.model.name || displayedModel.value?.provider.name || t("chat.model.noModel");
  if (!autoRoute.value) return modelName;
  return t("model-routing.modelRouting.autoTitle", { model: modelName, reason: routingReason.value || t("model-routing.modelRouting.autoSubtitle") });
});

const triggerAria = computed(() =>
  dualMode.value
    ? t("chat.model.labelDual", { plan: planSlot.value.label, act: actSlot.value.label })
    : t("chat.model.label", {
        name: displayedModel.value?.model.name || displayedModel.value?.provider.name || t("chat.model.noModel"),
      }),
);

const phaseTabs = computed(() => [
  { id: "plan" as const, label: t("chat.model.phasePlan") },
  { id: "act" as const, label: t("chat.model.phaseAct") },
]);

function slotOf(phase: "plan" | "act"): PhaseSlot {
  return phase === "plan" ? planSlot.value : actSlot.value;
}

function railClass(id: string | "recent") {
  return classes(
    "flex min-h-[30px] items-center justify-start gap-2 rounded-lg px-2 text-left text-[12px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]",
    [activeProviderId.value === id, "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"],
  );
}

async function pick(providerId: string, modelId: string) {
  if (activePhase.value) {
    await chatStore.setPhaseModel(activePhase.value, providerId, modelId);
  } else {
    modelsStore.setAutoRoute(false);
    await chatStore.setSessionModel(providerId, modelId);
  }
  const key = itemKey(providerId, modelId);
  recentKeys.value = [key, ...recentKeys.value.filter((k) => k !== key)].slice(0, 8);
  open.value = false;
}

/**
 * 顶部首项：模型 tab 选中「自动（推荐）」清掉会话级覆盖，每次发送前路由；
 * 阶段 tab 选中「跟随全局默认」清掉本会话的阶段覆盖（回落全局默认 / 会话模型）。
 */
async function pickTopChoice() {
  if (activePhase.value) {
    await chatStore.setPhaseModel(activePhase.value, null, null);
  } else {
    modelsStore.setAutoRoute(true);
    await chatStore.setSessionModel(null, null);
  }
  open.value = false;
}

function selectProvider(id: string | "recent" | null) {
  activeProviderId.value = id;
  query.value = "";
}

/** 可用高度 = 触发器顶边到窗口顶边的距离（弹层与其保留 8px 间距），上限 440px */
function syncMaxHeight() {
  const top = rootEl.value?.getBoundingClientRect().top ?? 0;
  maxHeight.value = Math.max(180, Math.min(440, Math.round(top - 16)));
}

function toggleOpen() {
  open.value = !open.value;
  if (open.value) {
    syncMaxHeight();
    void modelsStore.refresh();
    if (!activeProviderId.value && displayedSelection.value.providerId) {
      activeProviderId.value = displayedSelection.value.providerId;
    }
    void nextTick(() => searchEl.value?.focus());
  }
}

function onDocClick(event: MouseEvent) {
  const el = rootEl.value;
  if (el && !el.contains(event.target as Node)) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", syncMaxHeight);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", syncMaxHeight);
});

watch(providers, () => {
  if (open.value && !activeProviderId.value && enabledGroups.value[0]) {
    activeProviderId.value = enabledGroups.value[0].id;
  }
});

watch(activeTab, () => {
  query.value = "";
  if (!activeProviderId.value && displayedSelection.value.providerId) {
    activeProviderId.value = displayedSelection.value.providerId;
  }
});
</script>

<template>
  <div ref="rootEl" class="relative min-w-0">
    <Button
      variant="ghost"
      class="inline-flex items-center rounded-lg text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-hover)] disabled:cursor-not-allowed disabled:opacity-55"
      :class="compact
        ? ['h-7 justify-center', dualMode ? 'min-w-7 gap-0 px-1.5' : 'size-7']
        : 'max-w-[280px] gap-1.5 px-1.5 py-1 text-[12px]'"
      :disabled="!enabledGroups.length"
      :title="triggerTitle"
      :aria-label="triggerAria"
      @click="toggleOpen"
    >
      <!-- 小屏双模型：头像组（计划 / 执行 两个品牌图标叠放） -->
      <span v-if="compact && dualMode" class="flex items-center -space-x-1.5">
        <VendorLogo
          :vendor="planSlot.vendor || planSlot.label || t('chat.model.noModel')"
          :size="15"
          class="rounded-md ring-2 ring-[var(--color-composer-surface)]"
        />
        <VendorLogo
          :vendor="actSlot.vendor || actSlot.label || t('chat.model.noModel')"
          :size="15"
          class="rounded-md ring-2 ring-[var(--color-composer-surface)]"
        />
      </span>
      <VendorLogo
        v-else
        :vendor="displayedModel?.provider.name || displayedModel?.model.name || t('chat.model.noModel')"
        :size="16"
      />
      <span v-if="!compact && autoRoute && !dualMode" class="shrink-0 text-[var(--color-accent)]" :title="triggerTitle">
        <Sparkles class="size-3" aria-hidden="true" />
      </span>
      <!-- 单模型：一个名字；双模型：计划 → 执行，两个名字都要看得见 -->
      <span v-if="!compact && dualMode" class="flex min-w-0 items-center gap-1 font-medium">
        <span class="max-w-[112px] truncate">{{ planSlot.label || t("chat.model.noModel") }}</span>
        <ArrowRight class="size-3 shrink-0 text-[var(--color-dim)]" aria-hidden="true" />
        <span class="max-w-[112px] truncate">{{ actSlot.label || t("chat.model.noModel") }}</span>
      </span>
      <span v-else-if="!compact" class="truncate font-medium">{{ displayedModel?.model.name || displayedModel?.provider.name || t("chat.model.noModel") }}</span>
      <svg
        v-if="!compact"
        class="size-3 shrink-0 text-[var(--color-mut)]"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </Button>

    <div
      v-if="open"
      class="absolute bottom-[calc(100%+8px)] left-0 z-[var(--z-popup)] flex w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] shadow-[var(--shadow-menu)]"
      :style="maxHeight ? { maxHeight: `${maxHeight}px` } : undefined"
      role="listbox"
      :aria-label="t('chat.model.select')"
    >
      <div class="flex flex-none gap-3.5 border-b border-[var(--color-line)] px-3.5 pt-2.5">
        <Button
          v-for="tab in tabs"
          :key="tab.id"
          variant="ghost"
          class="relative h-auto rounded-none px-0 pb-2 text-[12px] font-normal hover:bg-transparent"
          :class="
            activeTab === tab.id
              ? 'font-semibold text-[var(--color-txt-strong)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-t after:bg-[var(--color-accent)] after:content-\'\']'
              : 'text-[var(--color-mut)]'
          "
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </Button>
      </div>

      <template v-if="activeTab === 'model' || activePhase">
        <!-- 计划 / 执行同一 tab：上方两个阶段卡，点击切换要改的阶段，两个模型的当前值一眼可见 -->
        <div
          v-if="activePhase"
          class="flex flex-none items-stretch gap-1.5 border-b border-[var(--color-line)] px-3 py-2"
        >
          <Button
            v-for="phase in phaseTabs"
            :key="phase.id"
            variant="ghost"
            class="flex min-w-0 flex-1 flex-col items-start gap-0 rounded-lg px-2.5 py-1.5 text-left font-normal hover:bg-[var(--color-menu-hover)]"
            :class="
              editingPhase === phase.id
                ? 'border border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[var(--color-menu-active)]'
                : 'border border-transparent'
            "
            :aria-label="t('chat.model.editPhase', { phase: phase.label })"
            :title="t('chat.model.editPhaseHint')"
            @click="editingPhase = phase.id"
          >
            <span class="flex w-full items-center gap-1.5 text-[10px] text-[var(--color-dim)]">
              {{ phase.label }}
              <span
                v-if="slotOf(phase.id).source !== 'session'"
                class="rounded-full border border-[var(--color-line-strong)] px-1 text-[10px] font-normal text-[var(--color-mut)]"
              >
                {{ sourceLabel[slotOf(phase.id).source] }}
              </span>
            </span>
            <span class="w-full truncate text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ slotOf(phase.id).label || t("chat.model.noModel") }}
            </span>
          </Button>
        </div>

        <div class="flex flex-none items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <Search class="size-3.5 shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
          <Input
            ref="searchEl"
            v-model="query"
            variant="ghost"
            class="h-6 min-w-0 flex-1 text-[12px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
            type="search"
            :placeholder="t('chat.model.search')"
          />
        </div>

        <!-- 列各占一行/一列且可收缩（minmax(0,1fr)）：列表超长时在自身容器内滚动，不再溢出弹层 -->
        <div
          class="grid min-h-0 flex-1"
          :class="compact
            ? 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]'
            : 'grid-cols-[168px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'"
        >
          <nav
            class="flex min-h-0 gap-0.5 overflow-auto bg-[var(--color-sunken)] p-1.5"
            :class="compact ? 'flex-row border-b border-[var(--color-line)]' : 'flex-col border-r border-[var(--color-line)]'"
            :aria-label="t('chat.model.providers')"
          >
            <Button variant="ghost" :class="railClass('recent')" @click="selectProvider('recent')">
              <History class="size-4 shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
              <span class="truncate font-normal">{{ t("chat.model.recentlyUsed") }}</span>
            </Button>
            <Button
              v-for="group in enabledGroups"
              :key="group.id"
              variant="ghost"
              :class="railClass(group.id)"
              @click="selectProvider(group.id)"
            >
              <VendorLogo :vendor="group.name" :size="16" />
              <span class="truncate font-normal">{{ group.name }}</span>
            </Button>
          </nav>

          <div class="min-h-0 overflow-auto p-1.5">
            <!-- 顶部常驻项：模型 tab = 自动（推荐）；阶段 tab = 跟随全局默认（清除会话覆盖） -->
            <div v-if="!query.trim()" class="mb-1 border-b border-[var(--color-line-soft)] pb-1">
              <Button
                variant="ghost"
                class="flex min-h-[40px] w-full items-center justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-normal hover:bg-[var(--color-menu-hover)]"
                :class="
                  topChoiceSelected
                    ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                    : 'text-[var(--color-txt)]'
                "
                :aria-label="activePhase ? t('chat.model.followGlobal') : t('model-routing.modelRouting.autoAria')"
                :title="activePhase ? t('chat.model.followGlobalHint') : t('model-routing.modelRouting.autoHint')"
                @click="pickTopChoice"
              >
                <Check
                  class="size-3.5 shrink-0 text-[var(--color-accent)]"
                  :class="topChoiceSelected ? '' : 'invisible'"
                  aria-hidden="true"
                />
                <Sparkles class="size-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate">{{ activePhase ? t('chat.model.followGlobal') : t("model-routing.modelRouting.auto") }}</span>
                  <span class="text-[11px] font-normal leading-4 text-[var(--color-mut)]">
                    {{ activePhase ? t('chat.model.followGlobalHint') : t("model-routing.modelRouting.autoSubtitle") }}
                  </span>
                  <!-- 阶段 tab：会话未覆盖时展示全局默认及其来源 -->
                  <span v-if="activePhase && globalPhaseDefault" class="truncate text-[11px] font-normal leading-4 text-[var(--color-accent)]">
                    {{ t("chat.model.followGlobalCurrent", { model: globalPhaseDefaultLabel }) }}
                  </span>
                  <span v-else-if="activePhase" class="truncate text-[11px] font-normal leading-4 text-[var(--color-dim)]">
                    {{ t("chat.model.followGlobalUnset") }}
                  </span>
                  <span v-if="!activePhase && autoRoute && lastRouting" class="truncate text-[11px] font-normal leading-4 text-[var(--color-mut)]">
                    {{ t("model-routing.modelRouting.routedTo", { model: lastRouting.modelName }) }}
                  </span>
                </span>
              </Button>
              <!-- 上次路由理由（简短）：仅自动模式下有记录时展示 -->
              <p
                v-if="!activePhase && autoRoute && routingReason"
                class="m-0 px-2.5 pb-1.5 pt-0.5 text-[11px] leading-4 text-[var(--color-mut)]"
                :title="routingReason"
              >
                {{ t("model-routing.modelRouting.reasonPrefix") }}{{ routingReason }}
              </p>
            </div>
            <Button
              v-for="item in filtered"
              :key="itemKey(item.providerId, item.model.id)"
              variant="ghost"
              class="flex min-h-[34px] w-full items-center justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-normal hover:bg-[var(--color-menu-hover)]"
              :class="
                isSelected(item.providerId, item.model.id)
                  ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                  : 'text-[var(--color-txt)]'
              "
              @click="pick(item.providerId, item.model.id)"
            >
              <Check
                class="size-3.5 shrink-0 text-[var(--color-accent)]"
                :class="isSelected(item.providerId, item.model.id) ? '' : 'invisible'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate">
                <span>{{ item.model.name }}</span>
                <!-- 阶段 tab：标出全局默认来源（会话未覆盖时即生效模型） -->
                <span
                  v-if="isPhaseGlobalDefault(item.providerId, item.model.id)"
                  class="ml-1.5 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] font-normal text-[var(--color-mut)]"
                >
                  {{ t("chat.model.globalDefault") }}
                </span>
              </span>
              <span
                v-if="item.model.custom"
                class="shrink-0 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] font-normal text-[var(--color-mut)]"
              >
                {{ t("chat.model.custom") }}
              </span>
            </Button>
            <p v-if="!filtered.length" class="m-0 px-3 py-4 text-center text-[12px] text-[var(--color-mut)]">
              {{ t("chat.model.noMatch") }}
            </p>
          </div>
        </div>
      </template>

      <div v-else class="m-0 px-3 py-4 text-center text-[12px] text-[var(--color-mut)]">
        {{ activeTab === "sub" ? t("chat.model.noSubAgents") : t("chat.model.noExternalAgents") }}
      </div>
    </div>
  </div>
</template>
