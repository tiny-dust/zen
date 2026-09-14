<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";

import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const emit = defineEmits<{
  openSettings: [];
}>();

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const { auth } = storeToRefs(userStore);

const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);

function onWindowClick(event: MouseEvent) {
  const root = menuEl.value;
  if (root && event.target instanceof Node && !root.contains(event.target)) {
    menuOpen.value = false;
  }
}

function onAvatarClick(event: MouseEvent) {
  event.stopPropagation();
  if (!auth.value.loggedIn) {
    void userStore.login();
    return;
  }
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    window.addEventListener("click", onWindowClick, { once: true });
  }
}

function onOpenSettings() {
  menuOpen.value = false;
  settingsStore.openSettings();
  emit("openSettings");
}

function onLogout() {
  menuOpen.value = false;
  void userStore.logout();
}
</script>

<template>
  <div ref="menuEl" class="user-block">
    <button type="button" class="user-trigger" @click="onAvatarClick">
      <div v-if="auth.loggedIn && auth.user" class="avatar">
        <img v-if="auth.user.avatarUrl" :src="auth.user.avatarUrl" alt="" />
        <span v-else>{{ auth.user.login.slice(0, 1).toUpperCase() }}</span>
      </div>
      <div v-else class="avatar avatar--guest">?</div>
      <div class="user-meta">
        <div class="user-name">
          {{ auth.loggedIn && auth.user ? auth.user.name || auth.user.login : "未登录" }}
        </div>
        <div class="user-sub">
          {{ auth.loggedIn && auth.user ? `@${auth.user.login}` : "点击进行 GitHub 授权" }}
        </div>
      </div>
    </button>

    <div v-if="menuOpen && auth.loggedIn" class="menu" role="menu">
      <button type="button" class="menu-item" role="menuitem" @click="onOpenSettings">
        <span class="menu-icon" aria-hidden="true" />
        设置
      </button>
      <button type="button" class="menu-item menu-item--danger" role="menuitem" @click="onLogout">
        <span class="menu-icon menu-icon--danger" aria-hidden="true" />
        退出登录
      </button>
    </div>
  </div>
</template>

<style scoped>
.user-block {
  position: relative;
}

.user-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background var(--motion-fast) var(--ease-enter);
}

.user-trigger:hover {
  background: var(--color-side-hover);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
  font-size: 12px;
  font-weight: 600;
  flex: none;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar--guest {
  border: 1px dashed var(--color-btn-border);
  color: var(--color-mut);
  background: transparent;
}

.user-meta {
  min-width: 0;
  flex: 1;
}

.user-name {
  font-size: 13px;
  color: var(--color-txt-strong);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-sub {
  font-size: 11px;
  color: var(--color-mut);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  z-index: 20;
  padding: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-menu);
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--color-txt);
  font-size: 13px;
  text-align: left;
}

.menu-item:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.menu-item--danger:hover {
  color: var(--color-danger-fg);
}

.menu-icon {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--color-side-sel);
  border: 1px solid var(--color-line);
}

.menu-icon--danger {
  border-color: var(--color-danger-fg);
  background: color-mix(in srgb, var(--color-danger-fg) 25%, transparent);
}
</style>
