<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref } from "vue";

import AppIcon from "@/components/base/AppIcon.vue";
import { Response } from "@/components/ai-elements/response";
import { CODE_THEMES } from "@/components/ai-elements/response/extensions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings";
import { BUILTIN_APP_ICONS } from "@zen/shared";

import type { UpdateStatusInfo } from "@zen/shared";

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const menuBarVisible = ref(true);

/** 代码主题预览片段：同一份代码左浅右深各渲染一份（取色规则见 styles.css 预览节） */
const PREVIEW_SNIPPET = `function greet() {
  const name = "world"
  console.log(name)
  return true
}`;

/** 软件更新（临时开放）：更新源 + 检查/下载/安装 */
const feedDraft = ref("");
const updateStatus = ref<UpdateStatusInfo>({ phase: "idle" });
const updateError = ref("");

const updateStatusText = computed(() => {
  switch (updateStatus.value.phase) {
    case "checking":
      return "正在检查更新…";
    case "available":
      return `发现新版本 v${updateStatus.value.version ?? ""}`;
    case "not-available":
      return "已是最新版本";
    case "downloading":
      return `正在下载更新 ${updateStatus.value.percent ?? 0}%`;
    case "downloaded":
      return `已下载 v${updateStatus.value.version ?? ""}，重启后安装`;
    case "error":
      return updateStatus.value.message || "更新失败";
    default:
      return "";
  }
});

const canInstall = computed(() => updateStatus.value.phase === "downloaded");
const canDownload = computed(() => updateStatus.value.phase === "available");
const appVersion = ref("");

onMounted(() => {
  feedDraft.value = settings.value.updateFeedUrl ?? "";
  const zen = window.zen;
  if (!zen) {
    return;
  }
  void zen.app.info().then((info) => {
    appVersion.value = info.version;
  });
  const off = zen.updates.onStatus((status) => {
    updateStatus.value = status;
    if (status.phase === "error") {
      updateError.value = status.message ?? "更新失败";
    }
  });
  onUnmounted(off);
});

function installUpdate() {
  window.zen?.updates.install();
}

async function saveFeed() {
  const url = feedDraft.value.trim() || null;
  await settingsStore.setFeedUrl(url);
  feedDraft.value = url ?? "";
}

async function checkUpdate() {
  const zen = window.zen;
  if (!zen || updateStatus.value.phase === "checking" || updateStatus.value.phase === "downloading") {
    return;
  }
  updateError.value = "";
  await saveFeed();
  const result = await zen.updates.check();
  if (!result.ok) {
    updateError.value = result.error ?? "检查更新失败";
  }
}

async function downloadUpdate() {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  updateError.value = "";
  const result = await zen.updates.download();
  if (!result.ok) {
    updateError.value = result.error ?? "下载失败";
  }
}
</script>

<template>
  <section class="flex flex-col">
    <Card size="sm" class="settings-card">
      <CardContent class="p-0">
        <div class="settings-row">
          <div>
            <div class="settings-row-title">默认打开目标</div>
            <div class="settings-row-desc">默认用哪个程序打开文件夹/位置</div>
          </div>
          <Badge variant="secondary">Finder</Badge>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">默认新建项目位置</div>
            <div class="settings-row-desc">新建空白项目默认落盘位置</div>
          </div>
          <Button variant="ghost" size="sm">选择目录</Button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">语言</div>
            <div class="settings-row-desc">应用 UI 语言</div>
          </div>
          <Badge variant="outline">简体中文</Badge>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">在菜单栏中显示</div>
            <div class="settings-row-desc">在 macOS 菜单栏显示 Zen 图标</div>
          </div>
          <Switch v-model="menuBarVisible" />
        </div>
      </CardContent>
    </Card>

    <!-- 软件更新（临时开放）：generic 更新源，局域网/本机静态目录即可 -->
    <h3 class="settings-section-title">软件更新</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="flex items-center gap-2">
          <Input
            v-model="feedDraft"
            class="h-8 min-w-0 flex-1 font-[family-name:var(--font-mono)] text-[12px]"
            placeholder="更新源地址，如 http://192.168.1.10:8899"
            aria-label="更新源地址"
            @keydown.enter="saveFeed"
          />
          <Button variant="outline" size="sm" class="flex-none" @click="saveFeed">保存</Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="updateStatus.phase === 'checking' || updateStatus.phase === 'downloading'"
            @click="checkUpdate"
          >
            {{ updateStatus.phase === "checking" ? "检查中…" : "检查更新" }}
          </Button>
          <Button
            v-if="canDownload"
            size="sm"
            @click="downloadUpdate"
          >
            下载更新
          </Button>
          <Button
            v-if="canInstall"
            size="sm"
            @click="installUpdate"
          >
            立即安装并重启
          </Button>
          <span class="text-[11px] text-[var(--color-dim)]">当前版本 v{{ appVersion }}</span>
        </div>
        <p
          v-if="updateStatusText"
          class="m-0 text-[12px]"
          :class="updateStatus.phase === 'error' ? 'text-[var(--color-err)]' : 'text-[var(--color-mut)]'"
          role="status"
        >
          {{ updateStatusText }}
        </p>
        <p v-if="updateError && updateStatus.phase !== 'error'" class="m-0 text-[12px] text-[var(--color-err)]">
          {{ updateError }}
        </p>
        <p class="m-0 text-[11px] leading-relaxed text-[var(--color-dim)]">
          默认指向本机 8899 端口；在仓库里运行 pnpm updates:serve 即可启动更新源（内含
          latest-mac.yml 与安装包），局域网机器改填对应 IP。
        </p>
      </CardContent>
    </Card>
  </section>

  <section class="flex flex-col">
    <h3 class="settings-section-title">代码主题</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <Select
          :model-value="settings.codeTheme"
          @update:model-value="settingsStore.setCodeTheme(String($event))"
        >
          <SelectTrigger class="h-9 w-full rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]">
            <SelectValue placeholder="选择代码主题" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="theme in CODE_THEMES"
                :key="theme.id"
                :value="theme.id"
              >
                {{ theme.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <!-- 预览：同一片段左浅右深各一份，切换主题即时刷新 -->
        <div class="grid grid-cols-2 overflow-hidden rounded-[10px] border border-[var(--color-line)]">
          <Response
            :key="`light-${settings.codeTheme}`"
            :content="'```ts\n' + PREVIEW_SNIPPET + '\n```'"
            class="md-content code-theme-preview code-theme-preview--light"
          />
          <Response
            :key="`dark-${settings.codeTheme}`"
            :content="'```ts\n' + PREVIEW_SNIPPET + '\n```'"
            class="md-content code-theme-preview code-theme-preview--dark"
          />
        </div>
        <p class="m-0 text-[11px] text-[var(--color-dim)]">
          主题同时作用于对话消息里的代码块；左侧为浅色模式、右侧为深色模式下的效果。
        </p>
      </CardContent>
    </Card>
  </section>

  <section class="flex flex-col">
    <h3 class="settings-section-title">应用图标</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <p class="mb-0 text-[12px] text-[var(--color-mut)]">切换后窗口 / Dock 图标会立即更新。</p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5">
          <button
            v-for="item in BUILTIN_APP_ICONS"
            :key="item.id"
            type="button"
            class="flex flex-col items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2 py-3 text-[12px] text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)]"
            :class="settings.iconId === item.id ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.setIcon(item.id)"
          >
            <AppIcon :id="item.id" :size="40" />
            <span>{{ item.label }}</span>
          </button>
          <button
            type="button"
            class="flex flex-col items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2 py-3 text-[12px] text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)]"
            :class="settings.iconId === 'custom' ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.pickCustomIcon()"
          >
            <AppIcon
              id="custom-preview"
              :size="40"
              :custom-path="settings.customIconPath"
            />
            <span>自定义</span>
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="w-fit"
          @click="settingsStore.pickCustomIcon()"
        >
          上传图标…
        </Button>
      </CardContent>
    </Card>
  </section>
</template>
