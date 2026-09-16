<script setup lang="ts">
import { HelpCircle, LogOut, Power, Settings } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const { auth, loading, loginError, deviceCode } = storeToRefs(userStore);

const open = ref(false);

watch(
  () => auth.value.loggedIn,
  (loggedIn) => {
    if (!loggedIn) {
      open.value = false;
    }
  },
);

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
    return `@${auth.value.user.login}`;
  }
  return "GitHub 授权登录";
});

const initials = computed(() => {
  const login = auth.value.user?.login;
  return login ? login.slice(0, 1).toUpperCase() : "?";
});

function onOpenChange(next: boolean) {
  if (!auth.value.loggedIn) {
    open.value = false;
    void userStore.login();
    return;
  }
  open.value = next;
}

function openSettings() {
  settingsStore.openSettings("general");
}

function onLogout() {
  void userStore.logout();
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

const menuItemCls =
  "min-h-8 gap-2 rounded-lg text-[var(--color-txt)] data-[danger]:text-[var(--color-danger-fg)]";
const menuIconCls = "size-[15px] flex-none text-[var(--color-mut)]";
const menuDanger = "text-[var(--color-danger-fg)] [&_svg]:text-[var(--color-danger-fg)]";
</script>

<template>
  <div class="w-full">
    <DropdownMenu :open="open" @update:open="onOpenChange">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="flex w-full flex-row items-center gap-2.5 rounded-[10px] border border-transparent bg-transparent p-2.5 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-[var(--color-side-hover)] data-[state=open]:bg-[var(--color-side-hover)]"
        >
          <Avatar class="size-7 flex-none rounded-lg">
            <AvatarImage
              v-if="auth.user?.avatarUrl"
              :src="auth.user.avatarUrl"
              :alt="auth.user.login"
            />
            <AvatarFallback class="text-[11px] font-semibold">{{ initials }}</AvatarFallback>
          </Avatar>
          <span class="flex min-w-0 flex-1 flex-col items-start">
            <span class="block w-full truncate text-[13px] leading-tight font-medium text-[var(--color-txt-strong)]">
              {{ displayName }}
            </span>
            <span class="block w-full truncate text-[11px] leading-tight text-[var(--color-mut)]">
              {{ displaySub }}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        v-if="auth.loggedIn"
        align="start"
        side="top"
        :side-offset="8"
        class="w-[var(--reka-dropdown-menu-trigger-width)] min-w-[220px]"
      >
        <DropdownMenuLabel class="px-2 py-1.5">
          <div class="flex items-center gap-2.5">
            <Avatar class="size-8 flex-none rounded-lg">
              <AvatarImage
                v-if="auth.user?.avatarUrl"
                :src="auth.user.avatarUrl"
                :alt="auth.user.login"
              />
              <AvatarFallback>{{ initials }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0 flex flex-col">
              <div class="truncate text-[13px] font-semibold text-[var(--color-txt-strong)]">
                {{ auth.user?.name || auth.user?.login }}
              </div>
              <div class="truncate text-[11px] text-[var(--color-mut)]">@{{ auth.user?.login }}</div>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem :class="menuItemCls" @select="openSettings">
            <Settings :class="menuIconCls" />
            <span>设置</span>
            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItemCls" disabled>
            <HelpCircle :class="menuIconCls" />
            <span>帮助与反馈</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem :class="[menuItemCls, menuDanger]" @select="onLogout">
            <LogOut :class="menuIconCls" />
            <span>退出登录</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="[menuItemCls, menuDanger]" @select="() => {}">
            <Power :class="menuIconCls" />
            <span>退出应用</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <div
      v-if="deviceCode && loading"
      class="mx-1 mt-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-set-card)] p-2.5"
      role="status"
    >
      <div class="text-[11px] text-[var(--color-mut)]">设备码</div>
      <code
        class="mt-1 block font-[family-name:var(--font-mono)] text-[15px] font-semibold tracking-[0.12em] text-[var(--color-txt-strong)]"
      >
        {{ deviceCode.userCode }}
      </code>
      <Button size="sm" variant="outline" class="mt-2 w-fit" @click="copyDeviceCode">
        复制
      </Button>
    </div>
    <p v-if="loginError" class="mx-1 mt-2 text-[11px] text-[var(--color-danger-fg)]" role="alert">
      {{ loginError }}
    </p>
  </div>
</template>
