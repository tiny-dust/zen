<script setup lang="ts">
import { Check, ExternalLink, HelpCircle, LogOut, Power, Settings } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onUnmounted, ref } from "vue";

import zenAvatar from "@/assets/agent-logos/zen.png";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
import FeishuLogo from "@/components/brand/FeishuLogo.vue";
import GithubMark from "@/components/brand/GithubMark.vue";
import { useAgentStore } from "@/stores/agent";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const agentStore = useAgentStore();
const { auth, loading, loginError, deviceCode } = storeToRefs(userStore);
const { larkStatus } = storeToRefs(agentStore);

/** 已连接的飞书身份（与 GitHub 登录并存） */
const larkIdentity = computed(() => {
  const snapshot = larkStatus.value?.auth;
  if (!snapshot?.available || !snapshot.userOpenId) {
    return null;
  }
  return {
    name: snapshot.userName || snapshot.userOpenId,
    avatarUrl: snapshot.userAvatarUrl,
  };
});

const githubConnected = computed(() => auth.value.loggedIn && Boolean(auth.value.user));
const larkConnected = computed(() => larkIdentity.value != null);

/** 展示偏好（settings 持久化；auto = GitHub 优先、无 GitHub 用飞书） */
const displayPref = computed(() => settingsStore.settings.displayAccount ?? "auto");
const displayedAccount = computed<"github" | "lark" | null>(() => {
  const pref = displayPref.value;
  if (pref === "github" && githubConnected.value) {
    return "github";
  }
  if (pref === "lark" && larkConnected.value) {
    return "lark";
  }
  if (githubConnected.value) {
    return "github";
  }
  if (larkConnected.value) {
    return "lark";
  }
  return null;
});

/** 账户菜单行：已登录可切换展示，未登录点击即发起登录/绑定 */
const accountRows = computed(() => {
  const otherConnected = (connected: boolean) => (connected ? "绑定" : "登录");
  return [
    {
      kind: "lark" as const,
      label: "飞书",
      name: larkIdentity.value?.name ?? null,
      connected: larkConnected.value,
      displayed: displayedAccount.value === "lark",
      action: larkConnected.value
        ? displayedAccount.value === "lark"
          ? "展示中"
          : "切换展示"
        : otherConnected(githubConnected.value),
    },
    {
      kind: "github" as const,
      label: "GitHub",
      name: auth.value.user?.name || auth.value.user?.login || null,
      connected: githubConnected.value,
      displayed: displayedAccount.value === "github",
      action: githubConnected.value
        ? displayedAccount.value === "github"
          ? "展示中"
          : "切换展示"
        : otherConnected(larkConnected.value),
    },
  ];
});

const open = ref(false);

/** 登录方式选择弹窗：choice（选飞书/GitHub）→ lark（飞书授权流程展示） */
const loginDialogOpen = ref(false);
type LarkLoginPhase = "choice" | "starting" | "waiting" | "error";
const larkLoginPhase = ref<LarkLoginPhase>("choice");
const larkLoginUrl = ref<string | null>(null);
const larkLoginError = ref<string | null>(null);

let disposeLarkLogin: (() => void) | null = null;

/** 订阅主进程 lark:login-event（首次进入弹窗时挂，组件卸载时清理） */
function ensureLarkLoginListener() {
  if (disposeLarkLogin) {
    return;
  }
  disposeLarkLogin =
    window.zen?.lark?.onLoginEvent((event) => {
      if (event.status === "url") {
        larkLoginPhase.value = "waiting";
        larkLoginUrl.value = event.url;
        // 授权页走系统浏览器，与设置页登录流程一致
        void window.zen?.app.openSystemExternal(event.url);
      } else if (event.status === "done") {
        closeLoginDialog();
        void agentStore.refreshLark();
      } else if (event.status === "cancelled") {
        larkLoginPhase.value = "choice";
        larkLoginUrl.value = null;
      } else {
        larkLoginPhase.value = "error";
        larkLoginError.value = event.message;
        larkLoginUrl.value = null;
      }
    }) ?? null;
}

function openLoginDialog() {
  larkLoginPhase.value = "choice";
  larkLoginError.value = null;
  larkLoginUrl.value = null;
  ensureLarkLoginListener();
  loginDialogOpen.value = true;
}

function closeLoginDialog() {
  loginDialogOpen.value = false;
  larkLoginPhase.value = "choice";
  larkLoginError.value = null;
  larkLoginUrl.value = null;
}

function chooseGithub() {
  loginDialogOpen.value = false;
  larkLoginPhase.value = "choice";
  larkLoginError.value = null;
  larkLoginUrl.value = null;
  void userStore.login();
}

async function chooseLark() {
  larkLoginError.value = null;
  larkLoginUrl.value = null;
  larkLoginPhase.value = "starting";
  try {
    await window.zen?.lark?.login();
  } catch (error) {
    larkLoginPhase.value = "error";
    larkLoginError.value = error instanceof Error ? error.message : "发起飞书登录失败";
  }
}

/** 账户行点击：已登录 → 切换展示身份；未登录 → 发起该账户登录（另一账户已在线即「绑定」） */
function onAccountRowClick(kind: "github" | "lark") {
  if (kind === "github" && githubConnected.value) {
    void settingsStore.setDisplayAccount("github");
    return;
  }
  if (kind === "lark" && larkConnected.value) {
    void settingsStore.setDisplayAccount("lark");
    return;
  }
  if (kind === "github") {
    closeLoginDialog();
    void userStore.login();
    return;
  }
  open.value = false;
  openLoginDialog();
  void chooseLark();
}

function openLarkLoginUrl() {
  if (larkLoginUrl.value) {
    void window.zen?.app.openSystemExternal(larkLoginUrl.value);
  }
}

onUnmounted(() => {
  disposeLarkLogin?.();
  disposeLarkLogin = null;
});

/** 展示身份：displayAccount 决定，缺省 auto（GitHub 优先）；两者皆无时展示 Zen 免登录身份 */
const shownGithub = computed(() => displayedAccount.value === "github");
const shownLark = computed(() => displayedAccount.value === "lark");

const displayName = computed(() => {
  if (loading.value) {
    return deviceCode.value ? "在浏览器确认设备码" : "正在申请登录…";
  }
  if (shownGithub.value && auth.value.user) {
    return auth.value.user.name || auth.value.user.login;
  }
  if (shownLark.value && larkIdentity.value) {
    return larkIdentity.value.name;
  }
  return "Zen 用户";
});

const displaySub = computed(() => {
  if (loading.value) {
    return deviceCode.value ? `设备码 ${deviceCode.value.userCode}` : "即将打开 GitHub 授权页";
  }
  if (shownGithub.value && auth.value.user) {
    return `@${auth.value.user.login}`;
  }
  if (shownLark.value && larkIdentity.value) {
    return "飞书已连接";
  }
  return "本地模式 · 未登录";
});

const initials = computed(() => {
  if (shownGithub.value && auth.value.user?.login) {
    return auth.value.user.login.slice(0, 1).toUpperCase();
  }
  if (shownLark.value && larkIdentity.value) {
    return larkIdentity.value.name.slice(0, 1).toUpperCase();
  }
  return "Z";
});

const shownAvatarUrl = computed(() => {
  if (shownGithub.value && auth.value.user?.avatarUrl) {
    return auth.value.user.avatarUrl;
  }
  if (shownLark.value && larkIdentity.value?.avatarUrl) {
    return larkIdentity.value.avatarUrl;
  }
  return null;
});

function onOpenChange(next: boolean) {
  open.value = next;
}

function openSettings() {
  settingsStore.openSettings("general");
}

function openProfile() {
  settingsStore.openSettings("profile");
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
const menuDanger = "text-[var(--color-danger-fg)] [&_svg]:text-[var(--color-danger-fg)]";
const accountRowCls =
  "min-h-9 w-full gap-2 rounded-lg text-[var(--color-txt)] data-[highlighted]:bg-[var(--color-side-hover)]";
</script>

<template>
  <div class="w-full">
    <DropdownMenu :open="open" @update:open="onOpenChange">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          class="flex w-full flex-row items-center justify-start gap-2.5 rounded-[10px] border border-transparent bg-transparent p-2.5 text-left font-normal hover:bg-[var(--color-side-hover)] data-[state=open]:bg-[var(--color-side-hover)]"
        >
          <Avatar class="size-7 flex-none rounded-lg">
            <AvatarImage v-if="shownAvatarUrl" :src="shownAvatarUrl" :alt="displayName" />
            <AvatarImage v-else :src="zenAvatar" alt="Zen" />
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
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        :side-offset="8"
        class="w-[var(--reka-dropdown-menu-trigger-width)] min-w-[220px]"
      >
        <DropdownMenuLabel class="px-2 py-1.5">
          <div class="flex items-center gap-2.5">
            <Avatar class="size-8 flex-none rounded-lg">
              <AvatarImage v-if="shownAvatarUrl" :src="shownAvatarUrl" :alt="displayName" />
              <AvatarImage v-else :src="zenAvatar" alt="Zen" />
              <AvatarFallback>{{ initials }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0 flex flex-col">
              <div class="truncate text-[13px] font-semibold text-[var(--color-txt-strong)]">
                {{ displayName }}
              </div>
              <div class="truncate text-[11px] text-[var(--color-mut)]">
                {{ displaySub }}
              </div>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <!-- 账户区：登录/绑定 + 选择展示身份 -->
        <DropdownMenuGroup>
          <DropdownMenuItem
            v-for="row in accountRows"
            :key="row.kind"
            :class="accountRowCls"
            :disabled="row.connected && row.displayed"
            @select="onAccountRowClick(row.kind)"
          >
            <FeishuLogo v-if="row.kind === 'lark'" class="size-4 flex-none" />
            <GithubMark v-else class="size-4 flex-none text-[var(--color-txt)]" />
            <span class="flex min-w-0 flex-1 flex-col items-start">
              <span class="block w-full truncate text-[12.5px] leading-tight">
                {{ row.connected ? row.name : `登录${row.label}` }}
              </span>
              <span class="block w-full truncate text-[10.5px] leading-tight text-[var(--color-mut)]">
                {{ row.connected ? row.label : row.action === "绑定" ? "绑定后与另一账户并存" : `${row.label} 授权` }}
              </span>
            </span>
            <Check v-if="row.connected && row.displayed" class="size-3.5 flex-none text-[var(--color-ok)]" />
            <span
              v-else-if="row.connected"
              class="flex-none text-[10.5px] text-[var(--color-mut)]"
            >
              {{ row.action }}
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem :class="menuItemCls" @select="openSettings">
            <Settings class="size-[15px] flex-none text-[var(--color-mut)]" />
            <span>设置</span>
            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItemCls" @select="openProfile">
            <HelpCircle class="size-[15px] flex-none text-[var(--color-mut)]" />
            <span>个人资料与同步</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem v-if="githubConnected" :class="[menuItemCls, menuDanger]" @select="onLogout">
            <LogOut class="size-[15px] flex-none" />
            <span>退出 GitHub 登录</span>
          </DropdownMenuItem>
          <DropdownMenuItem :class="[menuItemCls, menuDanger]" @select="() => {}">
            <Power class="size-[15px] flex-none" />
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

    <!-- 登录方式选择：飞书优先，GitHub 其次；登录其一后可绑定另一个 -->
    <Dialog :open="loginDialogOpen" @update:open="(next) => (next ? openLoginDialog() : closeLoginDialog())">
      <DialogContent
        class="w-[min(420px,calc(100vw-48px))] gap-3 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
        :show-close-button="false"
      >
        <template v-if="larkLoginPhase === 'choice'">
          <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
            选择登录方式
          </DialogTitle>
          <DialogDescription class="text-[12.5px] leading-normal text-[var(--color-mut)]">
            两个账户可并存绑定：登录其一后，在账户菜单点击另一个即可绑定。飞书连接桥接；GitHub 同步个人资料与配置。
          </DialogDescription>
          <div class="mt-1 grid w-full grid-cols-2 gap-2">
            <button
              type="button"
              class="flex flex-col items-start gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-left transition-colors duration-[var(--motion-fast)] hover:border-[var(--color-line)]"
              @click="chooseLark"
            >
              <span class="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-txt-strong)]">
                <FeishuLogo class="size-4" />
                飞书
              </span>
              <span class="text-[11.5px] leading-snug text-[var(--color-mut)]">
                浏览器授权 · 连接飞书桥接
              </span>
            </button>
            <button
              type="button"
              class="flex flex-col items-start gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-left transition-colors duration-[var(--motion-fast)] hover:border-[var(--color-line)]"
              @click="chooseGithub"
            >
              <span class="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-txt-strong)]">
                <GithubMark class="size-4" />
                GitHub
              </span>
              <span class="text-[11.5px] leading-snug text-[var(--color-mut)]">
                设备码授权 · 同步资料与配置
              </span>
            </button>
          </div>
          <div class="flex justify-end">
            <Button variant="ghost" size="sm" @click="closeLoginDialog">取消</Button>
          </div>
        </template>

        <template v-else>
          <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
            飞书登录
          </DialogTitle>
          <p v-if="larkLoginPhase === 'starting'" class="m-0 text-[12.5px] text-[var(--color-mut)]">
            正在发起飞书授权…
          </p>
          <template v-else-if="larkLoginPhase === 'waiting'">
            <DialogDescription class="text-[12.5px] leading-normal text-[var(--color-mut)]">
              请在浏览器中完成飞书授权（链接 10 分钟内有效），完成后此处会自动关闭。
            </DialogDescription>
            <Button v-if="larkLoginUrl" variant="outline" size="sm" class="w-fit" @click="openLarkLoginUrl">
              打开飞书授权页面
              <ExternalLink data-icon="inline-end" />
            </Button>
          </template>
          <p v-else class="m-0 text-[12.5px] text-[var(--color-danger-fg)]">{{ larkLoginError }}</p>
          <div class="flex justify-end">
            <Button variant="ghost" size="sm" @click="larkLoginPhase = 'choice'">返回</Button>
          </div>
        </template>
      </DialogContent>
    </Dialog>
  </div>
</template>
