<script setup lang="ts">
import { Check, CloudDownload, CloudUpload, ExternalLink } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import zenAvatar from "@/assets/agent-logos/zen.png";
import FeishuLogo from "@/components/brand/FeishuLogo.vue";
import GithubMark from "@/components/brand/GithubMark.vue";
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
const { settings: agentSettings, syncBusy, lastSync, larkStatus } = storeToRefs(agentStore);

const user = computed(() => auth.value.user);

/** 登录方式选择面板是否展开（点击「登录」后先选 GitHub / 飞书） */
const loginChoiceOpen = ref(false);
/** 飞书登录流程阶段（事件由主进程 lark:login-event 推送） */
type LarkLoginPhase = "idle" | "starting" | "waiting" | "done" | "cancelled" | "error";
const larkPhase = ref<LarkLoginPhase>("idle");
const larkUrl = ref<string | null>(null);
const larkError = ref<string | null>(null);
const larkActive = computed(() => larkPhase.value !== "idle");

/** 已连接的飞书身份（复用飞书桥接的 auth 快照；可与 GitHub 登录并存） */
const larkIdentity = computed(() => {
  const snapshot = larkStatus.value?.auth;
  if (!snapshot?.available || !snapshot.userOpenId) {
    return null;
  }
  return snapshot.userName || snapshot.userOpenId;
});

/** 左下角展示身份偏好（auto = GitHub 优先） */
const displayPref = computed(() => settingsStore.settings.displayAccount ?? "auto");

let disposeLarkLogin: (() => void) | null = null;
onMounted(() => {
  disposeLarkLogin =
    window.zen?.lark?.onLoginEvent((event) => {
      if (event.status === "url") {
        larkPhase.value = "waiting";
        larkUrl.value = event.url;
        // 授权页走系统浏览器，避免在内置浏览器打开与设置弹窗冲突；按钮仅作手动兜底
        void window.zen?.app.openSystemExternal(event.url);
      } else if (event.status === "done") {
        larkPhase.value = "done";
        larkUrl.value = null;
        void agentStore.refreshLark();
      } else if (event.status === "cancelled") {
        larkPhase.value = "cancelled";
        larkUrl.value = null;
      } else {
        larkPhase.value = "error";
        larkError.value = event.message;
        larkUrl.value = null;
      }
    }) ?? null;
});
onUnmounted(() => {
  disposeLarkLogin?.();
  disposeLarkLogin = null;
});

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
      // 打开设置即刷新飞书身份快照（登录后展示「飞书：xxx」）
      void agentStore.refreshLark();
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

/** 选择 GitHub：收起选择面板，走既有 device flow */
function chooseGithub() {
  loginChoiceOpen.value = false;
  larkPhase.value = "idle";
  larkError.value = null;
  void userStore.login();
}

/** 选择飞书：主进程发起 lark-cli device flow，结果经 lark:login-event 推送 */
async function chooseLark() {
  loginChoiceOpen.value = false;
  larkError.value = null;
  larkUrl.value = null;
  larkPhase.value = "starting";
  try {
    await window.zen?.lark?.login();
  } catch (error) {
    larkPhase.value = "error";
    larkError.value = error instanceof Error ? error.message : "发起飞书登录失败";
  }
}

async function cancelLark() {
  await window.zen?.lark?.cancelLogin();
}

function openLarkUrl() {
  if (larkUrl.value) {
    void window.zen?.app.openSystemExternal(larkUrl.value);
  }
}

/** 从飞书流程终态回到初始（可重新发起或改选 GitHub） */
function resetLark() {
  larkPhase.value = "idle";
  larkError.value = null;
  larkUrl.value = null;
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

        <!-- 飞书桥接身份（与 GitHub 账号并存展示，互不覆盖） -->
        <div v-if="larkIdentity" class="flex items-center gap-1.5 text-[12px] text-[var(--color-txt)]">
          <FeishuLogo class="size-3.5 flex-none" />
          <span>飞书：{{ larkIdentity }}（已连接）</span>
        </div>

        <!-- 关联账户：登录其一后可绑定另一个；两账户并存时可选择左下角展示身份 -->
        <div
          v-if="larkIdentity"
          class="flex flex-col gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3"
        >
          <div class="text-[13px] font-semibold text-[var(--color-txt-strong)]">关联账户</div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors duration-[var(--motion-fast)]"
              :class="
                displayPref === 'lark'
                  ? 'border-[var(--color-ok)] text-[var(--color-txt-strong)]'
                  : 'border-[var(--color-line-soft)] text-[var(--color-mut)] hover:border-[var(--color-line)]'
              "
              @click="settingsStore.setDisplayAccount('lark')"
            >
              <FeishuLogo class="size-3.5 flex-none" />
              展示飞书（{{ larkIdentity }}）
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors duration-[var(--motion-fast)]"
              :class="
                displayPref !== 'lark'
                  ? 'border-[var(--color-ok)] text-[var(--color-txt-strong)]'
                  : 'border-[var(--color-line-soft)] text-[var(--color-mut)] hover:border-[var(--color-line)]'
              "
              @click="settingsStore.setDisplayAccount('github')"
            >
              展示 GitHub（@{{ user.login }}）
            </button>
          </div>
        </div>

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

        <!-- 已连接的飞书身份（与 GitHub 账号并存展示，互不覆盖） -->
        <div v-if="larkIdentity" class="flex items-center gap-1.5 text-[12px] text-[var(--color-txt)]">
          <FeishuLogo class="size-3.5 flex-none" />
          <span>飞书：{{ larkIdentity }}（已连接）</span>
        </div>

        <!-- 飞书登录流程状态 -->
        <div
          v-if="larkActive"
          class="flex w-full flex-col gap-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3"
        >
          <p v-if="larkPhase === 'starting'" class="m-0 text-[12px] text-[var(--color-mut)]">
            正在发起飞书授权…
          </p>
          <template v-else-if="larkPhase === 'waiting' && larkUrl">
            <p class="m-0 text-[12px] leading-normal text-[var(--color-txt)]">
              请在浏览器中完成飞书授权（链接 10 分钟内有效），完成后此处会自动更新。
            </p>
            <Button variant="outline" size="sm" class="w-fit" @click="openLarkUrl">
              打开飞书授权页面
              <ExternalLink data-icon="inline-end" />
            </Button>
          </template>
          <p v-else-if="larkPhase === 'done'" class="m-0 text-[12px] text-[var(--color-ok)]">
            飞书{{ larkIdentity ? `：${larkIdentity}` : "" }}已连接
          </p>
          <p v-else-if="larkPhase === 'cancelled'" class="m-0 text-[12px] text-[var(--color-mut)]">
            已取消飞书登录
          </p>
          <p v-else-if="larkPhase === 'error'" class="m-0 text-[12px] text-[var(--color-danger-fg)]">
            {{ larkError }}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button v-if="larkPhase === 'waiting'" variant="outline" size="sm" @click="cancelLark">
              取消登录
            </Button>
            <Button v-else size="sm" variant="outline" @click="resetLark">
              {{ larkPhase === "done" ? "完成" : "返回" }}
            </Button>
          </div>
        </div>

        <!-- 登录方式选择（飞书优先 / GitHub） -->
        <div v-else-if="loginChoiceOpen" class="flex w-full flex-col gap-2">
          <div class="grid w-full grid-cols-2 gap-2">
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
                设备码授权 · 同步个人资料与配置
              </span>
            </button>
          </div>
          <Button variant="ghost" size="xs" class="w-fit" @click="loginChoiceOpen = false">
            返回
          </Button>
        </div>

        <div v-else class="flex flex-wrap gap-2">
          <Button size="sm" :disabled="loading" @click="loginChoiceOpen = true">
            {{ loading && !deviceCode ? "等待授权…" : "登录" }}
          </Button>
          <Button size="sm" variant="outline" disabled title="登录后可用">
            配置云同步（需登录）
          </Button>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
