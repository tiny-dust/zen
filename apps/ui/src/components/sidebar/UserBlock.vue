<script setup lang="ts">
import { Gauge, HelpCircle, LogOut, Power, Settings, UserRound } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const emit = defineEmits<{
  openSettings: [];
}>();

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const { auth, loading, loginError, deviceCode } = storeToRefs(userStore);

const open = ref(false);

const displayName = computed(() => {
  if (loading.value) {
    return deviceCode.value ? "在浏览器确认设备码" : "正在申请登录…";
  }
  if (auth.value.loggedIn && auth.value.user) {
    return auth.value.user.name || auth.value.user.login;
  }
  return "未登录";
});

const displaySub = computed(() => {
  if (loading.value) {
    return deviceCode.value ? `设备码 ${deviceCode.value.userCode}` : "即将打开 GitHub 授权页";
  }
  if (auth.value.loggedIn && auth.value.user) {
    return "已登录";
  }
  return "点击进行 GitHub 授权";
});

const initials = computed(() => {
  const login = auth.value.user?.login;
  return login ? login.slice(0, 1).toUpperCase() : "?";
});

function onOpenChange(next: boolean) {
  if (next && !auth.value.loggedIn) {
    void userStore.login();
    open.value = false;
    return;
  }
  if (next && loading.value) {
    open.value = false;
    return;
  }
  open.value = next;
}

function openGeneral() {
  open.value = false;
  settingsStore.openSettings("general");
  emit("openSettings");
}

function openProfile() {
  open.value = false;
  settingsStore.openSettings("profile");
  emit("openSettings");
}

function openModels() {
  open.value = false;
  settingsStore.openSettings("models");
  emit("openSettings");
}

function onLogout() {
  open.value = false;
  void userStore.logout();
}

function onQuit() {
  open.value = false;
}

async function copyDeviceCode() {
  const code = deviceCode.value?.userCode;
  if (!code) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="user-block">
    <DropdownMenu :open="open" @update:open="onOpenChange">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="user-trigger"
          :aria-expanded="open"
          :aria-haspopup="auth.loggedIn ? 'menu' : undefined"
        >
          <span class="user-avatar">
            <Avatar class="user-avatar-el">
              <AvatarImage
                v-if="auth.user?.avatarUrl"
                :src="auth.user.avatarUrl"
                :alt="auth.user.login"
              />
              <AvatarFallback class="user-avatar-fb">{{ initials }}</AvatarFallback>
            </Avatar>
          </span>
          <span class="user-meta">
            <span class="user-name">{{ displayName }}</span>
            <span class="user-sub">{{ displaySub }}</span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        :side-offset="8"
        class="user-menu w-[268px] rounded-xl border border-border bg-popover p-1.5 shadow-menu"
      >
        <DropdownMenuLabel class="user-menu-head">
          <Avatar class="user-menu-avatar">
            <AvatarImage
              v-if="auth.user?.avatarUrl"
              :src="auth.user.avatarUrl"
              :alt="auth.user.login"
            />
            <AvatarFallback>{{ initials }}</AvatarFallback>
          </Avatar>
          <span class="user-menu-id">
            <span class="user-menu-name">{{ auth.user?.name || auth.user?.login }}</span>
            <span class="user-menu-status">已登录</span>
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator class="mx-1" />

        <DropdownMenuItem class="user-menu-item" @select="openProfile">
          <UserRound />
          <span>个人资料</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="user-menu-item" @select="openGeneral">
          <Settings />
          <span>设置</span>
          <span class="user-menu-kbd">⌘,</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="user-menu-item" @select="openModels">
          <Gauge />
          <span>模型供应</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="user-menu-item" disabled>
          <HelpCircle />
          <span>帮助与反馈</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator class="mx-1" />

        <DropdownMenuItem class="user-menu-item user-menu-item--danger" @select="onLogout">
          <LogOut />
          <span>退出登录</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="user-menu-item user-menu-item--danger" @select="onQuit">
          <Power />
          <span>退出应用</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <div v-if="deviceCode && loading" class="device-code" role="status">
      <div class="device-code-label">设备码</div>
      <code class="device-code-value">{{ deviceCode.userCode }}</code>
      <Button size="sm" variant="outline" class="mt-2 w-fit" @click="copyDeviceCode">
        复制
      </Button>
    </div>
    <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
  </div>
</template>

<style>
.user-menu-head {
  display: flex !important;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 8px !important;
}

.user-menu-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex: none;
}

.user-menu-id {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-menu-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-txt-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu-status {
  font-size: 11px;
  color: var(--color-mut);
}

.user-menu-item {
  min-height: 36px;
  border-radius: 10px;
  padding-left: 10px !important;
  padding-right: 10px !important;
  gap: 10px;
  font-size: 13px;
  color: var(--color-txt) !important;
}

.user-menu-item svg {
  width: 16px;
  height: 16px;
  flex: none;
  opacity: 0.95;
}

.user-menu-item[data-disabled] {
  opacity: 0.45;
}

.user-menu-item--danger,
.user-menu-item--danger[data-highlighted] {
  color: var(--color-danger-fg) !important;
}

.user-menu-kbd {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-mut);
}

.shadow-menu {
  box-shadow: var(--shadow-menu);
}
</style>

<style scoped>
.user-block {
  width: 100%;
}

.user-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  text-align: left;
  background: color-mix(in srgb, var(--color-side-sel) 70%, transparent);
  border: 1px solid transparent;
  transition: background var(--motion-fast) var(--ease-enter);
}

.user-trigger:hover:not(:disabled) {
  background: var(--color-side-hover);
}

.user-trigger:disabled {
  opacity: 0.75;
}

.user-trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
}

.user-avatar {
  flex: none;
  width: 32px;
  height: 32px;
}

.user-avatar-el {
  width: 32px;
  height: 32px;
  border-radius: 999px;
}

.user-avatar-fb {
  font-size: 12px;
  font-weight: 600;
}

.user-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-txt-strong);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-sub {
  font-size: 11px;
  color: var(--color-mut);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-code {
  margin: 8px 4px 0;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
}

.device-code-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-mut);
}

.device-code-value {
  display: block;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--color-txt-strong);
}

.login-error {
  margin: 8px 4px 0;
  font-size: 11px;
  color: var(--color-danger-fg);
}
</style>
