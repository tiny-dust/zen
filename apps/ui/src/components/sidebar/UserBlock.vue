<script setup lang="ts">
import { Settings, UserRound, LogOut, Power, HelpCircle, Gauge } from "@lucide/vue";
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
    return deviceCode.value
      ? `设备码 ${deviceCode.value.userCode}`
      : "即将打开 GitHub 授权页";
  }
  if (auth.value.loggedIn && auth.value.user) {
    return "已登录";
  }
  return "点击进行 GitHub 授权";
});

const initials = computed(() => {
  const login = auth.value.user?.login;
  if (!login) {
    return "?";
  }
  return login.slice(0, 1).toUpperCase();
});

function onTriggerClick(event: MouseEvent) {
  event.stopPropagation();
  if (!auth.value.loggedIn) {
    void userStore.login();
    return;
  }
  open.value = !open.value;
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
  void window.zen?.app.openExternal?.("about:blank");
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
    <DropdownMenu v-model:open="open">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          class="user-trigger h-auto w-full justify-start gap-2.5 px-2.5 py-2"
          :disabled="loading"
          @click="onTriggerClick"
        >
          <Avatar class="size-8 shrink-0">
            <AvatarImage
              v-if="auth.user?.avatarUrl"
              :src="auth.user.avatarUrl"
              :alt="auth.user.login"
            />
            <AvatarFallback class="text-xs font-semibold">{{ initials }}</AvatarFallback>
          </Avatar>
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-[13px] font-medium text-foreground">
              {{ displayName }}
            </span>
            <span class="block truncate text-[11px] text-muted-foreground">
              {{ displaySub }}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        class="user-menu w-[260px] rounded-xl border-border bg-popover p-1.5"
      >
        <DropdownMenuLabel class="px-2.5 py-2">
          <div class="flex items-center gap-2.5">
            <Avatar class="size-9">
              <AvatarImage
                v-if="auth.user?.avatarUrl"
                :src="auth.user.avatarUrl"
                :alt="auth.user.login"
              />
              <AvatarFallback class="text-sm">{{ initials }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-foreground">
                {{ auth.user?.name || auth.user?.login }}
              </div>
              <div class="truncate text-[11px] text-muted-foreground">已登录</div>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem class="menu-row" @select="openProfile">
          <UserRound />
          个人资料
        </DropdownMenuItem>
        <DropdownMenuItem class="menu-row" @select="openGeneral">
          <Settings />
          设置
          <span class="ml-auto text-[11px] text-muted-foreground">⌘,</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="menu-row" @select="openModels">
          <Gauge />
          模型供应
        </DropdownMenuItem>
        <DropdownMenuItem class="menu-row" disabled>
          <HelpCircle />
          帮助与反馈
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem class="menu-row text-destructive" @select="onLogout">
          <LogOut />
          退出登录
        </DropdownMenuItem>
        <DropdownMenuItem class="menu-row text-destructive" @select="onQuit">
          <Power />
          退出应用
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <div v-if="deviceCode && loading" class="device-code" role="status">
      <div class="text-[10px] uppercase tracking-wide text-muted-foreground">设备码</div>
      <code class="text-base font-semibold tracking-[0.12em] text-foreground">
        {{ deviceCode.userCode }}
      </code>
      <Button
        size="xs"
        variant="outline"
        class="mt-1 w-fit"
        @click="copyDeviceCode"
      >
        复制
      </Button>
    </div>
    <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
  </div>
</template>

<style scoped>
.user-block {
  width: 100%;
}

.user-trigger {
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-side-sel) 80%, transparent);
}

.user-trigger:hover {
  background: var(--color-side-hover);
}

.device-code {
  margin: 8px 10px 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
}

.login-error {
  margin: 8px 10px 0;
  font-size: 11px;
  color: var(--color-danger-fg);
}

:deep(.menu-row) {
  min-height: 36px;
  border-radius: 10px;
  padding-left: 10px;
  padding-right: 10px;
  gap: 10px;
  font-size: 13px;
  color: var(--color-txt);
}

:deep(.menu-row svg) {
  width: 16px;
  height: 16px;
  opacity: 0.9;
}
</style>
