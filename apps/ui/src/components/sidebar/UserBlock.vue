<script setup lang="ts">
import { Gauge, HelpCircle, LogOut, Power, Settings, UserRound } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const emit = defineEmits<{
  openSettings: [];
}>();

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const { auth, loading, loginError, deviceCode } = storeToRefs(userStore);

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

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

function onWindowClick(event: MouseEvent) {
  const root = rootEl.value;
  if (root && event.target instanceof Node && !root.contains(event.target)) {
    open.value = false;
  }
}

function onTriggerClick(event: MouseEvent) {
  event.stopPropagation();
  if (!auth.value.loggedIn) {
    void userStore.login();
    return;
  }
  open.value = !open.value;
  if (open.value) {
    window.addEventListener("click", onWindowClick);
  }
}

function closeMenu() {
  open.value = false;
  window.removeEventListener("click", onWindowClick);
}

function openGeneral() {
  closeMenu();
  settingsStore.openSettings("general");
  emit("openSettings");
}

function openProfile() {
  closeMenu();
  settingsStore.openSettings("profile");
  emit("openSettings");
}

function openModels() {
  closeMenu();
  settingsStore.openSettings("models");
  emit("openSettings");
}

function onLogout() {
  closeMenu();
  void userStore.logout();
}

function onQuit() {
  closeMenu();
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

onMounted(() => {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("click", onWindowClick);
});
</script>

<template>
  <div ref="rootEl" class="user-block">
    <button type="button" class="user-trigger" @click="onTriggerClick">
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

    <div v-if="open && auth.loggedIn" class="menu" role="menu" @click.stop>
      <div class="menu-head" role="none">
        <Avatar class="menu-avatar">
          <AvatarImage
            v-if="auth.user?.avatarUrl"
            :src="auth.user.avatarUrl"
            :alt="auth.user.login"
          />
          <AvatarFallback>{{ initials }}</AvatarFallback>
        </Avatar>
        <div class="menu-id">
          <div class="menu-name">{{ auth.user?.name || auth.user?.login }}</div>
          <div class="menu-status">已登录</div>
        </div>
      </div>

      <div class="menu-sep" />

      <button type="button" class="menu-item" role="menuitem" @click="openProfile">
        <UserRound class="menu-icon" />
        <span class="menu-label">个人资料</span>
      </button>
      <button type="button" class="menu-item" role="menuitem" @click="openGeneral">
        <Settings class="menu-icon" />
        <span class="menu-label">设置</span>
        <span class="menu-kbd">⌘,</span>
      </button>
      <button type="button" class="menu-item" role="menuitem" @click="openModels">
        <Gauge class="menu-icon" />
        <span class="menu-label">模型供应</span>
      </button>
      <button type="button" class="menu-item" role="menuitem" disabled>
        <HelpCircle class="menu-icon" />
        <span class="menu-label">帮助与反馈</span>
      </button>

      <div class="menu-sep" />

      <button type="button" class="menu-item menu-item--danger" role="menuitem" @click="onLogout">
        <LogOut class="menu-icon" />
        <span class="menu-label">退出登录</span>
      </button>
      <button type="button" class="menu-item menu-item--danger" role="menuitem" @click="onQuit">
        <Power class="menu-icon" />
        <span class="menu-label">退出应用</span>
      </button>
    </div>

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

<style scoped>
.user-block {
  position: relative;
  width: 100%;
}

.user-trigger {
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  text-align: left;
  background: color-mix(in srgb, var(--color-side-sel) 70%, transparent);
  border: 1px solid transparent;
  transition: background var(--motion-fast) var(--ease-enter);
}

.user-trigger:hover {
  background: var(--color-side-hover);
}

.user-avatar {
  flex: 0 0 auto;
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
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.user-name {
  display: block;
  width: 100%;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-txt-strong);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-sub {
  display: block;
  width: 100%;
  font-size: 11px;
  color: var(--color-mut);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 80;
  width: 100%;
  min-width: 240px;
  max-width: 280px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-menu);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}

.menu-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 8px;
}

.menu-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex: 0 0 auto;
}

.menu-id {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.menu-name {
  width: 100%;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-txt-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-status {
  width: 100%;
  font-size: 11px;
  color: var(--color-mut);
}

.menu-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--color-line);
  flex: none;
}

.menu-item {
  width: 100%;
  min-height: 36px;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--color-txt);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}

.menu-item:hover:not(:disabled) {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.menu-item:disabled {
  opacity: 0.4;
}

.menu-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: block;
}

.menu-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-kbd {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--color-mut);
}

.menu-item--danger {
  color: var(--color-danger-fg);
}

.menu-item--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger-fg) 10%, transparent);
  color: var(--color-danger-fg);
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
