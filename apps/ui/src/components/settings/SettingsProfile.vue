<script setup lang="ts">
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
  if (u.blog) {
    lines.push(u.blog.replace(/^https?:\/\//, ""));
  }
  return lines;
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
  <section class="section">
    <h3>个人资料</h3>
    <p class="hint">GitHub 账号信息，登录后自动获取头像与公开资料。</p>

    <Card v-if="auth.loggedIn && user" size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-4 p-4">
        <div class="profile-main">
          <Avatar class="size-16 rounded-2xl">
            <AvatarImage v-if="user.avatarUrl" :src="user.avatarUrl" :alt="user.login" />
            <AvatarFallback class="text-lg">{{ user.login.slice(0, 1).toUpperCase() }}</AvatarFallback>
          </Avatar>
          <div class="identity">
            <div class="display-name">{{ user.name || user.login }}</div>
            <div class="login-row">
              <span class="login">@{{ user.login }}</span>
              <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="onOpenProfile">
                GitHub ↗
              </Button>
            </div>
            <p v-if="user.bio" class="bio">{{ user.bio }}</p>
            <ul v-if="metaLines.length" class="meta">
              <li v-for="line in metaLines" :key="line">{{ line }}</li>
            </ul>
            <Button
              v-if="user.blog"
              variant="link"
              size="sm"
              class="h-auto w-fit max-w-full p-0 text-xs"
              @click="onOpenBlog"
            >
              <span class="truncate">{{ user.blog.replace(/^https?:\/\//, "") }} ↗</span>
            </Button>
          </div>
        </div>

        <div class="stats">
          <div v-for="item in stats" :key="item.label" class="stat">
            <div class="stat-value">{{ item.value }}</div>
            <div class="stat-label">{{ item.label }}</div>
          </div>
        </div>

        <div class="actions">
          <Button variant="outline" :disabled="refreshing" @click="userStore.refreshProfile()">
            {{ refreshing ? "刷新中…" : "刷新资料" }}
          </Button>
          <Button variant="destructive" @click="userStore.logout()">退出登录</Button>
        </div>
      </CardContent>
    </Card>

    <Card v-else size="sm" class="settings-card">
      <CardContent class="flex flex-col items-start gap-2 p-4">
        <div class="guest-title">未登录</div>
        <p class="guest-desc">
          使用 GitHub Device Flow 登录后，这里会显示头像、简介与仓库统计。
        </p>
        <div v-if="deviceCode && loading" class="device-hint">
          浏览器若未预填，请输入设备码
          <code>{{ deviceCode.userCode }}</code>
        </div>
        <p v-if="loginError" class="error">{{ loginError }}</p>
        <Button :disabled="loading" @click="userStore.login()">
          {{ loading ? "等待授权…" : "使用 GitHub 登录" }}
        </Button>
      </CardContent>
    </Card>
  </section>
</template>

<style scoped>
.section h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--color-txt-strong);
}

.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-mut);
  line-height: 1.5;
}

.profile-card {
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.profile-card--guest {
  align-items: flex-start;
  gap: 10px;
}

.profile-main {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.avatar {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  overflow: hidden;
  flex: none;
  display: grid;
  place-items: center;
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
  font-size: 22px;
  font-weight: 600;
  border: 1px solid var(--color-line);
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.identity {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.display-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-txt-strong);
  line-height: 1.2;
}

.login-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.login {
  font-size: 13px;
  color: var(--color-mut);
}

.linkish {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 12px;
  cursor: pointer;
}

.linkish:hover {
  text-decoration: underline;
}

.bio {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-txt);
  line-height: 1.5;
}

.meta {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--color-mut);
}

.blog {
  align-self: flex-start;
  margin-top: 2px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.stat {
  padding: 10px 8px;
  border-radius: 8px;
  border: 1px solid var(--color-line-soft);
  background: var(--color-input-bg);
  text-align: center;
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-txt-strong);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-mut);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.guest-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.guest-desc {
  margin: 0;
  font-size: 12px;
  color: var(--color-mut);
  line-height: 1.5;
}

.device-hint {
  font-size: 12px;
  color: var(--color-txt);
}

.device-hint code {
  margin-left: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-input-bg);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger-fg);
}
</style>
