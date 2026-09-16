<script setup lang="ts">
import { Boxes, Keyboard, Settings2, UserRound, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import SettingsGeneral from "@/components/settings/SettingsGeneral.vue";
import SettingsModels from "@/components/settings/SettingsModels.vue";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import SettingsShortcuts from "@/components/settings/SettingsShortcuts.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings";

import type { SettingsTab } from "@/stores/settings";

const settingsStore = useSettingsStore();
const { settingsOpen, activeTab } = storeToRefs(settingsStore);

const search = ref("");

const navGroups = computed(() => [
  {
    title: "通用",
    items: [
      { id: "general" as const, label: "常规", icon: Settings2 },
      { id: "shortcuts" as const, label: "键盘快捷键", icon: Keyboard },
    ],
  },
  {
    title: "账号与模型",
    items: [
      { id: "profile" as const, label: "个人资料", icon: UserRound },
      { id: "models" as const, label: "模型供应", icon: Boxes },
    ],
  },
]);

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) {
    return navGroups.value;
  }
  return navGroups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
    }))
    .filter((group) => group.items.length > 0);
});

const paneTitle = computed(() => {
  switch (activeTab.value) {
    case "models":
      return "模型供应";
    case "profile":
      return "个人资料";
    case "shortcuts":
      return "键盘快捷键";
    default:
      return "常规";
  }
});

/** 每个面板的说明只在这里写一次，子面板不再重复标题与描述 */
const paneDesc = computed(() => {
  switch (activeTab.value) {
    case "models":
      return "自定义 OpenAI / Anthropic 兼容供应商，支持三种消息协议。";
    case "profile":
      return "GitHub 账号信息，登录后自动获取头像与公开资料。";
    case "shortcuts":
      return "点击输入框后按下组合键即可重新绑定。";
    default:
      return "默认打开方式、项目位置、菜单栏与图标。";
  }
});

function selectTab(next: SettingsTab) {
  settingsStore.openSettings(next);
  const hash = `#settings/${next}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

watch(
  () => settingsOpen.value,
  (open) => {
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
      aria-label="设置"
    >
      <aside
        class="flex min-h-0 flex-col gap-2.5 overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-settings-nav)] p-3.5"
      >
        <div class="px-2 pb-0.5 text-[13px] font-semibold text-[var(--color-txt-strong)]">设置</div>
        <Input
          v-model="search"
          class="h-[30px] w-full flex-none text-[13px]"
          placeholder="搜索设置"
        />

        <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div class="flex flex-col gap-3.5 py-0.5 pb-3">
            <div v-for="group in filteredGroups" :key="group.title">
              <div class="px-2.5 pb-1.5 text-[11px] text-[var(--color-dim)]">
                {{ group.title }}
              </div>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="flex min-h-8 w-full flex-row items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]"
                :class="
                  activeTab === item.id
                    ? 'bg-[var(--color-side-active)] font-medium text-[var(--color-txt-strong)]'
                    : ''
                "
                @click="selectTab(item.id)"
              >
                <component :is="item.icon" class="size-[15px] flex-none" />
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main
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
            aria-label="关闭"
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
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
