<script setup lang="ts">
import { Bot, Boxes, Keyboard, MessageSquare, Search, Settings2, Sparkles, UserRound, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import SettingsAgent from "@/components/settings/SettingsAgent.vue";
import SettingsGeneral from "@/components/settings/SettingsGeneral.vue";
import SettingsLark from "@/components/settings/SettingsLark.vue";
import SettingsModels from "@/components/settings/SettingsModels.vue";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import SettingsPrompts from "@/components/settings/SettingsPrompts.vue";
import SettingsShortcuts from "@/components/settings/SettingsShortcuts.vue";
import { searchSettings } from "@/components/settings/settings-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings";

import type { SettingsTab } from "@/stores/settings";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settingsOpen, activeTab } = storeToRefs(settingsStore);

const search = ref("");
/** 面板滚动容器：搜索命中后把小节滚进可视区 */
const paneScroll = ref<HTMLElement | null>(null);

const navGroups = computed(() => [
  {
    title: t("settings.nav.groupPrefs"),
    items: [
      { id: "general" as const, label: t("settings.nav.general"), icon: Settings2 },
      { id: "shortcuts" as const, label: t("settings.nav.shortcuts"), icon: Keyboard },
    ],
  },
  {
    title: t("settings.nav.groupAgent"),
    items: [
      { id: "agent" as const, label: t("settings.nav.agent"), icon: Bot },
      { id: "lark" as const, label: t("settings.nav.lark"), icon: MessageSquare },
      { id: "prompts" as const, label: t("settings.nav.prompts"), icon: Sparkles },
    ],
  },
  {
    title: t("settings.nav.groupAccount"),
    items: [
      { id: "profile" as const, label: t("settings.nav.profile"), icon: UserRound },
      { id: "models" as const, label: t("settings.nav.models"), icon: Boxes },
    ],
  },
]);

/** 命中的设置项列表（tab 名 + 小节名 + 关键词匹配） */
const searchResults = computed(() =>
  searchSettings(search.value, (key) => t(key)),
);

const searching = computed(() => search.value.trim().length > 0);

function tabLabel(tab: SettingsTab): string {
  const map: Record<SettingsTab, string> = {
    general: t("settings.nav.general"),
    shortcuts: t("settings.nav.shortcuts"),
    agent: t("settings.nav.agent"),
    lark: t("settings.nav.lark"),
    prompts: t("settings.nav.prompts"),
    profile: t("settings.nav.profile"),
    models: t("settings.nav.models"),
    skills: t("settings.nav.general"),
    mcp: t("settings.nav.general"),
  };
  return map[tab];
}

const paneTitle = computed(() => tabLabel(activeTab.value));

/** 每个面板的说明只在这里写一次，子面板不再重复标题与描述 */
const paneDesc = computed(() => {
  switch (activeTab.value) {
    case "models":
      return t("settings.nav.descModels");
    case "profile":
      return t("settings.nav.descProfile");
    case "shortcuts":
      return t("settings.nav.descShortcuts");
    case "agent":
      return t("settings.nav.descAgent");
    case "lark":
      return t("settings.nav.descLark");
    case "prompts":
      return t("settings.nav.descPrompts");
    default:
      return t("settings.nav.descGeneral");
  }
});

function selectTab(next: SettingsTab) {
  settingsStore.openSettings(next);
  const hash = `#settings/${next}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

/** 搜索命中跳转：切 tab → 滚到小节锚点 → 底色短暂高亮（只做颜色反馈） */
async function jumpToResult(entry: { tab: SettingsTab; sectionId?: string }) {
  selectTab(entry.tab);
  search.value = "";
  if (!entry.sectionId) {
    return;
  }
  await nextTick();
  // 等面板内容挂载完成再定位；找不到锚点静默降级为只切 tab
  requestAnimationFrame(() => {
    const el = document.getElementById(entry.sectionId!);
    if (!el) {
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("settings-hit");
    window.setTimeout(() => el.classList.remove("settings-hit"), 1600);
  });
}

watch(
  () => settingsOpen.value,
  (open) => {
    if (!open) {
      search.value = "";
    }
    if (!open && window.location.hash.startsWith("#settings")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  },
);
</script>

<template>
  <div
    v-if="settingsOpen"
    class="fixed inset-0 z-[var(--z-overlay)] grid place-items-center bg-[var(--color-scrim)]"
    @click.self="settingsStore.closeSettings()"
  >
    <div
      class="grid h-[min(820px,calc(100vh-56px))] w-[min(1180px,calc(100vw-48px))] grid-cols-[208px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[var(--color-line)] bg-[var(--color-settings-content)] text-[var(--color-txt)] shadow-[var(--shadow-pop)]"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.nav.title')"
      data-select-text
    >
      <aside
        class="flex min-h-0 flex-col gap-2.5 overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-settings-nav)] p-3.5"
      >
        <div class="px-2.5 pb-0.5 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.nav.title") }}</div>
        <Input
          v-model="search"
          class="h-[30px] w-full flex-none bg-[var(--color-np-btn-bg)] text-[13px]"
          :placeholder="t('settings.nav.searchPlaceholder')"
        />

        <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <!-- 搜索中：设置项命中列表（点击直达对应小节） -->
          <div v-if="searching" class="flex flex-col gap-0.5 py-0.5 pb-3">
            <div class="flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] text-[var(--color-dim)]">
              <Search class="size-3" aria-hidden="true" />
              {{ t("settings.nav.searchResults", { count: searchResults.length }) }}
            </div>
            <Button
              v-for="entry in searchResults"
              :key="`${entry.tab}-${entry.sectionId ?? 'page'}`"
              variant="ghost"
              class="flex min-h-9 w-full flex-row items-start justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left font-normal hover:bg-[var(--color-menu-hover)]"
              @click="jumpToResult(entry)"
            >
              <span class="flex min-w-0 flex-1 flex-col items-start">
                <span class="w-full truncate text-[12px] text-[var(--color-txt-strong)]">{{ entry.title }}</span>
                <span class="w-full truncate text-[11px] text-[var(--color-mut)]">
                  {{ tabLabel(entry.tab) }}
                </span>
              </span>
            </Button>
            <p
              v-if="!searchResults.length"
              class="m-0 px-2.5 py-2 text-[12px] text-[var(--color-dim)]"
            >
              {{ t("settings.nav.searchEmpty") }}
            </p>
          </div>

          <!-- 平时：分组导航 -->
          <div v-else class="flex flex-col gap-3.5 py-0.5 pb-3">
            <div v-for="group in navGroups" :key="group.title">
              <div class="px-2.5 pb-1.5 text-[11px] text-[var(--color-dim)]">
                {{ group.title }}
              </div>
              <Button
                v-for="item in group.items"
                :key="item.id"
                variant="ghost"
                class="flex min-h-8 w-full flex-row items-center justify-start gap-2 rounded-lg px-2.5 text-left text-[13px] font-normal text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]"
                :class="
                  activeTab === item.id
                    ? 'bg-[var(--color-side-active)] font-medium text-[var(--color-txt-strong)]'
                    : ''
                "
                @click="selectTab(item.id)"
              >
                <component :is="item.icon" class="size-[15px] flex-none" />
                <span>{{ item.label }}</span>
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <main
        ref="paneScroll"
        class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-settings-content)]"
      >
        <header class="flex flex-none items-start justify-between gap-3 px-[18px] pb-2.5 pt-3">
          <div class="min-w-0">
            <h2 class="m-0 text-[15px] font-semibold text-[var(--color-txt-strong)]">
              {{ paneTitle }}
            </h2>
            <p class="mt-0.5 truncate text-[12px] text-[var(--color-mut)]">{{ paneDesc }}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="flex-none text-[var(--color-mut)]"
            :aria-label="t('common.close')"
            @click="settingsStore.closeSettings()"
          >
            <X />
          </Button>
        </header>

        <Separator />

        <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div class="flex flex-col gap-3.5 px-[18px] pb-5 pt-3.5">
            <SettingsGeneral v-if="activeTab === 'general'" />
            <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" />
            <SettingsProfile v-else-if="activeTab === 'profile'" />
            <SettingsModels v-else-if="activeTab === 'models'" />
            <SettingsAgent v-else-if="activeTab === 'agent'" />
            <SettingsLark v-else-if="activeTab === 'lark'" />
            <SettingsPrompts v-else-if="activeTab === 'prompts'" />
            <div
              v-else-if="activeTab === 'skills' || activeTab === 'mcp'"
              class="text-[12px] text-[var(--color-mut)]"
            >
              {{ t("settings.nav.skillsMcpMoved") }}
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
