<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const { auth, loading, refreshing, deviceCode, loginError } = storeToRefs(userStore);

const user = computed(() => auth.value.user);
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
      </CardContent>
    </Card>

    <Card v-else size="sm" class="settings-card">
      <CardContent class="flex flex-col items-start gap-3 p-4">
        <div class="text-[14px] font-semibold text-[var(--color-txt-strong)]">未登录</div>
        <p class="m-0 text-[12px] leading-normal text-[var(--color-mut)]">
          使用 GitHub Device Flow 登录后，这里会显示头像、简介与仓库统计。
        </p>
        <div v-if="deviceCode && loading" class="text-[12px] text-[var(--color-txt)]">
          浏览器若未预填，请输入设备码
          <code
            class="ml-1 rounded bg-[var(--color-np-btn-bg)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] tracking-[0.08em]"
          >
            {{ deviceCode.userCode }}
          </code>
        </div>
        <p v-if="loginError" class="m-0 text-[12px] text-[var(--color-danger-fg)]">{{ loginError }}</p>
        <Button size="sm" :disabled="loading" @click="userStore.login()">
          {{ loading ? "等待授权…" : "使用 GitHub 登录" }}
        </Button>
      </CardContent>
    </Card>
  </section>
</template>
