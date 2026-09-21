<script setup lang="ts">
import { Check, CloudDownload, CloudUpload, ExternalLink } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";

import zenAvatar from "@/assets/agent-logos/zen.png";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useAgentStore } from "@/stores/agent";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const agentStore = useAgentStore();
const { auth, loading, refreshing, deviceCode, loginError, codeCopied } = storeToRefs(userStore);
const { settings: agentSettings, syncBusy, lastSync } = storeToRefs(agentStore);

const user = computed(() => auth.value.user);

/** 登录有效期：自登录起 3 个月 */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const expiryLabel = computed(() => {
  const loginAt = auth.value.loginAt;
  if (!loginAt) {
    return null;
  }
  const until = new Date(loginAt + SESSION_TTL_MS);
  return `登录有效期至 ${until.getFullYear()}/${until.getMonth() + 1}/${until.getDate()}（自登录起 3 个月）`;
});

const stats = computed(() => {
  const u = user.value;
  if (!u) {
    return [];
  }
  return [
    { label: "仓库", value: u.publicRepos ?? 0 },
    { label: "关注者", value: u.followers ?? 0 },
    { label: "正在关注", value: u.following ?? 0 },
  ];
});

const metaLines = computed(() => {
  const u = user.value;
  if (!u) {
    return [] as string[];
  }
  const lines: string[] = [];
  if (u.company) {
    lines.push(u.company);
  }
  if (u.location) {
    lines.push(u.location);
  }
  if (u.email) {
    lines.push(u.email);
  }
  return lines;
});

const blogLabel = computed(() => {
  const blog = user.value?.blog;
  return blog ? blog.replace(/^https?:\/\//, "") : "";
});

watch(
  () => settingsStore.settingsOpen,
  (open) => {
    if (open) {
      void userStore.refreshProfile();
    }
  },
);

function onOpenProfile() {
  if (user.value?.htmlUrl) {
    void userStore.openExternal(user.value.htmlUrl);
  }
}

function onOpenBlog() {
  if (!user.value?.blog) {
    return;
  }
  const url = user.value.blog.startsWith("http")
    ? user.value.blog
    : `https://${user.value.blog}`;
  void userStore.openExternal(url);
}
</script>

<template>
  <section class="flex flex-col">
    <Card v-if="auth.loggedIn && user" size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-4 p-4">
        <div class="flex items-start gap-3.5">
          <Avatar class="size-14 rounded-xl">
            <AvatarImage v-if="user.avatarUrl" :src="user.avatarUrl" :alt="user.login" />
            <AvatarFallback class="text-base">{{ user.login.slice(0, 1).toUpperCase() }}</AvatarFallback>
          </Avatar>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="text-[16px] leading-tight font-semibold text-[var(--color-txt-strong)]">
              {{ user.name || user.login }}
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[13px] text-[var(--color-mut)]">@{{ user.login }}</span>
              <Button variant="ghost" size="xs" class="h-auto gap-1 px-1.5 text-xs" @click="onOpenProfile">
                <ExternalLink data-icon="inline-start" />
                GitHub
              </Button>
            </div>
            <p v-if="user.bio" class="mt-1 text-[12px] leading-normal text-[var(--color-txt)]">
              {{ user.bio }}
            </p>
            <ul
              v-if="metaLines.length"
              class="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0 text-[12px] text-[var(--color-mut)]"
            >
              <li v-for="line in metaLines" :key="line">{{ line }}</li>
            </ul>
            <Button
              v-if="user.blog"
              variant="ghost"
              size="xs"
              class="h-auto w-fit max-w-full gap-1 px-1.5 text-xs"
              @click="onOpenBlog"
            >
              <span class="truncate">{{ blogLabel }}</span>
              <ExternalLink data-icon="inline-end" />
            </Button>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div
            v-for="item in stats"
            :key="item.label"
            class="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] px-2 py-2.5 text-center"
          >
            <div class="text-[16px] font-semibold tabular-nums text-[var(--color-txt-strong)]">
              {{ item.value }}
            </div>
            <div class="mt-0.5 text-[11px] text-[var(--color-mut)]">{{ item.label }}</div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" :disabled="refreshing" @click="userStore.refreshProfile()">
            {{ refreshing ? "刷新中…" : "刷新资料" }}
          </Button>
          <Button variant="destructive" size="sm" @click="userStore.logout()">退出登录</Button>
        </div>
        <p v-if="expiryLabel" class="m-0 text-[11px] text-[var(--color-dim)]">
          {{ expiryLabel }}
        </p>

        <!-- 配置云同步 -->
        <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[13px] font-semibold text-[var(--color-txt-strong)]">配置云同步</div>
            <label class="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--color-mut)]">
              <Checkbox
                :model-value="agentSettings.syncEnabled"
                aria-label="允许同步"
                @update:model-value="agentStore.updateSettings({ syncEnabled: !agentSettings.syncEnabled })"
              />
              允许同步
            </label>
          </div>
          <p class="m-0 text-[11.5px] leading-snug text-[var(--color-mut)]">
            将模型供应、Agent 设置与 MCP 配置同步到你的 GitHub 私密仓库（默认
            {{ agentSettings.syncRepo || "zen-config" }}）。API Key 属于敏感凭据，永远不会上传；登录授权需包含
            repo 权限（见 docs/auth/github-oauth-setup.md）。
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" :disabled="syncBusy || !agentSettings.syncEnabled" @click="agentStore.syncUpload()">
              <CloudUpload :size="13" data-icon="inline-start" />上传配置
            </Button>
            <Button variant="outline" size="sm" :disabled="syncBusy || !agentSettings.syncEnabled" @click="agentStore.syncDownload()">
              <CloudDownload :size="13" data-icon="inline-start" />下载并合并
            </Button>
          </div>
          <p
            v-if="lastSync"
            class="m-0 text-[11.5px]"
            :class="lastSync.ok ? 'text-[var(--color-mut)]' : 'text-[var(--color-danger-fg)]'"
          >
            {{ lastSync.ok ? `已同步 ${lastSync.repo ?? ""}${lastSync.summary ? `：${lastSync.summary}` : ""}` : lastSync.error }}
          </p>
        </div>
      </CardContent>
    </Card>

    <Card v-else size="sm" class="settings-card">
      <CardContent class="flex flex-col items-start gap-3 p-4">
        <div class="flex items-center gap-2.5">
          <Avatar class="size-10 flex-none rounded-xl">
            <AvatarImage :src="zenAvatar" alt="Zen" />
            <AvatarFallback>Z</AvatarFallback>
          </Avatar>
          <div>
            <div class="text-[14px] font-semibold text-[var(--color-txt-strong)]">Zen 用户</div>
            <div class="text-[12px] text-[var(--color-mut)]">本地模式 · 未登录</div>
          </div>
        </div>
        <p class="m-0 text-[12px] leading-normal text-[var(--color-mut)]">
          对话、模型、终端、Git、技能与 MCP 等功能均可直接使用。登录 GitHub 后可同步个人资料与配置到云端；不登录不影响本地能力。
        </p>
        <div v-if="deviceCode && loading" class="text-[12px] text-[var(--color-txt)]">
          浏览器若未预填，请输入设备码
          <Button
            variant="ghost"
            class="h-auto ml-1 inline-flex items-center gap-1 rounded bg-[var(--color-np-btn-bg)] px-1.5 py-0.5 align-middle font-[family-name:var(--font-mono)] text-[13px] font-normal tracking-[0.08em] transition-colors duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)] hover:bg-[var(--color-np-btn-bg)] dark:hover:bg-[var(--color-np-btn-bg)]"
            :aria-label="codeCopied ? '设备码已复制' : '点击复制设备码'"
            :title="codeCopied ? '已复制' : '点击复制'"
            @click="userStore.copyUserCode()"
          >
            {{ deviceCode.userCode }}
            <Check v-if="codeCopied" class="size-3 text-[var(--color-ok)]" aria-hidden="true" />
          </Button>
          <span v-if="codeCopied" class="ml-1 text-[11px] text-[var(--color-ok)]">已复制，可直接粘贴</span>
        </div>
        <p v-if="loginError" class="m-0 text-[12px] text-[var(--color-danger-fg)]">{{ loginError }}</p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" :disabled="loading" @click="userStore.login()">
            {{ loading ? "等待授权…" : "使用 GitHub 登录" }}
          </Button>
          <Button size="sm" variant="outline" disabled title="登录后可用">
            配置云同步（需登录）
          </Button>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
