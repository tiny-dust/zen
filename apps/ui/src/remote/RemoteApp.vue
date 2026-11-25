<script setup lang="ts">
import { ArrowLeft, ArrowUp, ChevronRight, RefreshCw, WifiOff } from "@lucide/vue";
import { computed, nextTick, shallowRef, useTemplateRef, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRemote } from "./useRemote";

const remote = useRemote();
const loginDeviceId = shallowRef("");
const username = shallowRef("");
const password = shallowRef("");
const draft = shallowRef("");
function login() {
  void remote.login(loginDeviceId.value, username.value.trim(), password.value).then(() => { password.value = ""; });
}
function switchDevice() {
  loginDeviceId.value = "";
  username.value = "";
  password.value = "";
  remote.switchDevice();
}
const timeline = useTemplateRef<HTMLElement>("timeline");
const view = computed(() => !remote.paired.value ? "pair" : remote.selectedId.value ? "conversation" : "sessions");
const statusLabel = computed(() => !remote.online.value ? "设备离线" : !remote.connected.value ? "正在同步" : "已连接");
const canSend = computed(() => remote.online.value && !remote.busy.value && Boolean(draft.value.trim()));

async function send() {
  const text = draft.value.trim();
  if (!text || !canSend.value) return;
  if (await remote.send(text)) draft.value = "";
}

function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void send();
}

watch(() => remote.messages.value, async () => {
  await nextTick();
  timeline.value?.scrollTo({ top: timeline.value.scrollHeight, behavior: "smooth" });
});
</script>

<template>
  <div class="remote-shell">
    <header class="remote-header">
      <div class="remote-heading">
        <Button v-if="view === 'conversation'" variant="ghost" size="icon-lg" aria-label="返回会话列表" @click="remote.leaveSession">
          <ArrowLeft />
        </Button>
        <div class="remote-title-group">
          <span class="remote-brand">Zen <span class="remote-brand-divider">/</span> 远程</span>
          <h1>{{ view === 'conversation' ? remote.selected.value?.title || '会话' : view === 'pair' ? '连接设备' : '会话' }}</h1>
        </div>
      </div>
      <Button v-if="view !== 'pair'" variant="ghost" size="icon-lg" aria-label="刷新连接" :disabled="remote.loading.value" @click="remote.start">
        <RefreshCw />
      </Button>
    </header>

    <main class="remote-main">
      <div v-if="remote.error.value" class="remote-error" role="alert">
        <span>{{ remote.error.value }}</span>
        <Button variant="ghost" size="sm" @click="remote.start">重试</Button>
      </div>

      <section v-if="remote.loading.value && !remote.paired.value" class="remote-center" role="status">
        <p>正在检查连接…</p>
      </section>

      <section v-else-if="view === 'pair'" class="remote-center remote-pair">
        <div class="remote-mark" aria-hidden="true">Z</div>
        <h2>在手机上继续对话</h2>
        <p>选择设备并输入该设备的登录凭据。</p>
        <form class="remote-pair-form" @submit.prevent="login">
          <label>设备</label>
          <div v-if="!remote.devices.value.length" class="remote-empty">暂无可用设备，请先在桌面端连接中继。</div>
          <div v-else class="remote-device-list" role="group" aria-label="选择设备">
            <Button v-for="device in remote.devices.value" :key="device.id" type="button" variant="ghost" class="remote-device"
              :aria-pressed="loginDeviceId === device.id" @click="loginDeviceId = device.id">
              {{ device.name }} · {{ device.online ? '在线' : '离线' }}
            </Button>
          </div>
          <label for="remote-username">用户名</label>
          <Input id="remote-username" v-model="username" autocomplete="username" :disabled="remote.busy.value" />
          <label for="remote-password">密码</label>
          <Input id="remote-password" v-model="password" type="password" autocomplete="current-password" :disabled="remote.busy.value" />
          <Button size="lg" type="submit" :disabled="remote.busy.value || !loginDeviceId || !username.trim() || !password">{{ remote.busy.value ? '登录中…' : '登录设备' }}</Button>
        </form>
      </section>

      <template v-else>
        <div class="remote-status" :class="{ 'remote-status--offline': !remote.online.value }" role="status" aria-live="polite">
          <WifiOff v-if="!remote.online.value" aria-hidden="true" />
          <span v-else class="remote-status-dot" aria-hidden="true"></span>
          <span>{{ statusLabel }}</span>
          <span v-if="!remote.online.value" class="remote-status-hint">请确认桌面端已打开，连接恢复后可继续。</span>
        </div>

        <section v-if="view === 'sessions'" class="remote-sessions" aria-label="会话列表">
          <div class="remote-section-heading">
            <h2>最近的会话</h2>
            <span>{{ remote.sessions.value.length }}</span>
          </div>
          <div class="remote-session-actions">
            <Select v-model="remote.workspaceId.value">
              <SelectTrigger aria-label="选择工作区"><SelectValue placeholder="公共区" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="common">公共区</SelectItem>
                <SelectItem v-for="workspace in remote.workspaces.value.filter((item) => item.id !== 'common')" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</SelectItem>
              </SelectContent>
            </Select>
            <Button :disabled="!remote.online.value || remote.busy.value" @click="remote.createSession">新建会话</Button>
          </div>
          <Button variant="ghost" class="remote-switch" @click="switchDevice">切换设备</Button>
          <p v-if="!remote.sessions.value.length" class="remote-empty">{{ remote.online.value ? '暂无会话。请先在桌面端创建会话。' : '设备离线，恢复连接后会自动加载会话。' }}</p>
          <ul v-else class="remote-session-list">
            <li v-for="session in remote.sessions.value" :key="session.id">
              <Button variant="ghost" class="remote-session" @click="remote.selectSession(session.id)">
                <span class="remote-session-copy">
                  <span class="remote-session-title">{{ session.title || '未命名会话' }}</span>
                  <span class="remote-session-meta">{{ session.state || '会话' }}<template v-if="session.updatedAt"> · {{ new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</template></span>
                </span>
                <ChevronRight aria-hidden="true" />
              </Button>
            </li>
          </ul>
        </section>

        <section v-else class="remote-conversation" aria-label="对话">
          <div ref="timeline" class="remote-timeline" data-select-text>
            <Button v-if="remote.olderCursor.value" variant="ghost" :disabled="remote.loadingOlder.value" @click="remote.loadOlder">{{ remote.loadingOlder.value ? '加载中…' : '加载更早' }}</Button>
            <p v-if="remote.generating.value" class="remote-generation" role="status">{{ remote.generationStatus.value || '正在生成…' }}</p>
            <p v-if="!remote.messages.value.length" class="remote-empty">还没有消息。在下方输入并发送，继续这个会话。</p>
            <div v-for="message in remote.messages.value" :key="message.id" class="remote-message" :class="{ 'remote-message--user': message.role === 'user' }">
              <span class="remote-message-label">{{ message.role === 'user' ? '你' : 'Zen' }}</span>
              <p>{{ message.content }}</p>
            </div>
          </div>
          <form class="remote-composer-wrap" @submit.prevent="send">
            <div class="remote-composer">
              <label for="remote-draft" class="sr-only">发送消息</label>
              <Textarea id="remote-draft" v-model="draft" variant="ghost" rows="2" placeholder="发送消息…" :disabled="!remote.online.value || remote.busy.value" @keydown.enter.exact="onEnter" />
              <Button type="submit" size="icon" class="remote-send" :disabled="!canSend" aria-label="发送消息"><ArrowUp /></Button>
            </div>
            <p class="remote-disclaimer">内容由 AI 生成，请注意核实</p>
          </form>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.remote-shell { display: flex; flex-direction: column; width: 100%; min-height: 100%; height: 100dvh; background: var(--color-bg); color: var(--color-txt); }
.remote-header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 76px; padding: max(14px, env(safe-area-inset-top)) 18px 12px; border-bottom: 1px solid var(--color-line-soft); }
.remote-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.remote-title-group { min-width: 0; }
.remote-brand { font-size: 11px; font-weight: 600; letter-spacing: .03em; color: var(--color-mut); }
.remote-brand-divider { padding: 0 3px; color: var(--color-dim); }
.remote-title-group h1 { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; font-weight: 650; letter-spacing: -.02em; color: var(--color-txt-strong); }
.remote-main { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.remote-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px; background: var(--color-danger-bg); color: var(--color-danger-fg); font-size: 13px; }
.remote-center { display: flex; flex: 1; flex-direction: column; justify-content: center; align-items: center; padding: 28px; text-align: center; }
.remote-pair { padding-bottom: max(80px, env(safe-area-inset-bottom)); }
.remote-mark { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 28px; border: 1px solid var(--color-line-strong); border-radius: var(--radius-shell); font-size: 27px; font-weight: 700; letter-spacing: -.08em; color: var(--color-txt-strong); }
.remote-pair h2 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.025em; color: var(--color-txt-strong); }
.remote-pair p { margin: 9px 0 32px; color: var(--color-mut); font-size: 14px; }
.remote-pair-form { display: flex; flex-direction: column; gap: 12px; width: min(100%, 340px); text-align: left; }
.remote-pair-form label { font-size: 12px; font-weight: 600; color: var(--color-mut); }
.remote-pair-form :deep([data-slot="input"]) { height: 44px; font-family: var(--font-mono); font-size: 17px; letter-spacing: .08em; }
.remote-pair-form :deep([data-slot="button"]) { min-height: 44px; margin-top: 8px; }
.remote-device-list { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; }
.remote-device { justify-content: flex-start; border: 1px solid var(--color-line-soft); }
.remote-device[aria-pressed="true"] { border-color: var(--color-line-strong); background: var(--color-side-sel); }
.remote-session-actions { display: flex; gap: 8px; margin-bottom: 8px; }
.remote-session-actions :deep([data-slot="select-trigger"]) { flex: 1; min-width: 0; }
.remote-switch { margin-bottom: 12px; }
.remote-generation { margin: 0; color: var(--color-mut); font-size: 12px; }
.remote-status { display: flex; align-items: center; gap: 8px; flex: none; min-height: 38px; padding: 7px 20px; border-bottom: 1px solid var(--color-line-soft); color: var(--color-mut); font-size: 12px; }
.remote-status svg { width: 14px; height: 14px; }
.remote-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-ok); }
.remote-status--offline { flex-wrap: wrap; background: var(--color-danger-bg); color: var(--color-danger-fg); }
.remote-status-hint { margin-left: auto; }
.remote-sessions { overflow: auto; width: 100%; max-width: 720px; margin: 0 auto; padding: 27px 18px 40px; }
.remote-section-heading { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 15px; color: var(--color-dim); font-size: 12px; }
.remote-section-heading h2 { margin: 0; color: var(--color-txt-strong); font-size: 14px; font-weight: 600; }
.remote-session-list { margin: 0; padding: 0; list-style: none; }
.remote-session-list li + li { border-top: 1px solid var(--color-line-soft); }
.remote-session { width: 100%; height: auto; min-height: 72px; padding: 11px 4px; justify-content: space-between; text-align: left; }
.remote-session-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.remote-session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-txt-strong); font-size: 14px; font-weight: 550; }
.remote-session-meta { color: var(--color-mut); font-size: 12px; font-weight: 400; }
.remote-session :deep(svg) { color: var(--color-dim); }
.remote-empty { margin: auto; padding: 40px 18px; color: var(--color-mut); text-align: center; font-size: 13px; }
.remote-conversation { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.remote-timeline { display: flex; flex: 1; flex-direction: column; gap: 25px; overflow-y: auto; min-height: 0; width: 100%; padding: 28px max(20px, calc((100% - 690px) / 2)) 30px; overscroll-behavior: contain; }
.remote-message { align-self: flex-start; max-width: 100%; min-width: 0; }
.remote-message-label { display: block; margin-bottom: 7px; font-size: 11px; font-weight: 600; color: var(--color-mut); }
.remote-message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-txt-strong); font-size: 14px; line-height: 1.75; user-select: text; }
.remote-message--user { align-self: flex-end; max-width: min(86%, 540px); padding: 10px 14px; border-radius: var(--radius-lg); background: var(--color-side-sel); }
.remote-message--user .remote-message-label { margin-bottom: 3px; }
.remote-composer-wrap { flex: none; width: 100%; padding: 12px max(16px, calc((100% - 690px) / 2)) max(10px, env(safe-area-inset-bottom)); background: var(--color-bg); box-shadow: var(--shadow-edge-top); }
.remote-composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px 9px 8px 13px; border-radius: var(--radius-shell); background: var(--color-composer-surface); box-shadow: var(--shadow-composer); }
.remote-composer :deep(textarea) { min-height: 46px; max-height: 160px; resize: none; padding: 5px 0; font-size: 16px; line-height: 1.5; color: var(--color-txt-strong); }
.remote-send { flex: none; margin-bottom: 2px; border-radius: var(--radius); background: var(--color-accent); color: var(--color-accent-fg); }
.remote-send:hover { background: var(--color-accent); }
.remote-send:disabled { background: var(--color-sunken); color: var(--color-dim); }
.remote-disclaimer { margin: 10px 0 0; color: var(--color-dim); font-size: 11px; text-align: center; }
@media (max-width: 420px) { .remote-status-hint { flex-basis: 100%; margin-left: 22px; } }
@media (prefers-reduced-motion: reduce) { .remote-shell * { scroll-behavior: auto !important; } }
</style>
