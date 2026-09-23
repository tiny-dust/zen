<script setup lang="ts">
import { Bot, Brain, FolderOpen, Plus, RefreshCw, ShieldCheck, TriangleAlert, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { MemoryScope, MemorySnapshot } from "@zen/shared";
import type { LarkGatewayState, PermissionMode, SandboxMode } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

/**
 * Agent 与权限：权限三档（默认/智能/完全访问）+ 项目隔离区 + 记忆。
 */
const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { larkStatus, settings, sandboxDir } = storeToRefs(agentStore);
const rebuildBusy = ref(false);
const rebuildMessage = ref("");

const currentProject = computed(() => {
  const group = workspaceStore.groups.find((item) => item.id === workspaceStore.activeId);
  return group && group.kind === "workspace" ? group : null;
});

function pickMode(mode: PermissionMode) {
  void agentStore.updateSettings({ permissionMode: mode });
}

function pickSandbox(mode: SandboxMode) {
  void agentStore.updateSettings({ sandboxMode: mode });
}

async function rebuild() {
  if (!currentProject.value?.path) {
    return;
  }
  rebuildBusy.value = true;
  rebuildMessage.value = "";
  const result = await agentStore.rebuildSandbox(currentProject.value.path);
  rebuildMessage.value = result.ok
    ? "已重建，下次会话生效"
    : (result.error ?? "重建失败");
  rebuildBusy.value = false;
}

// ---------- 记忆：设备环境快照 + 备注（Agent updateMemory / 手动维护共用） ----------
const memory = ref<MemorySnapshot | null>(null);
const memoryBusy = ref(false);
const deviceNoteText = ref("");
const userNoteText = ref("");
const pendingDelete = ref<{ scope: MemoryScope; id: string; text: string } | null>(null);
const deleteBusy = ref(false);

const deviceTools = computed(() => Object.entries(memory.value?.device?.tools ?? {}));
const deviceNoteList = computed(() => memory.value?.device?.notes ?? []);
const userNoteList = computed(() => memory.value?.user?.notes ?? []);

async function loadMemory() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memory.value = await zen.memory.get();
}

onMounted(() => {
  void loadMemory();
});

async function addNote(scope: MemoryScope) {
  const zen = window.zen;
  const text = (scope === "device" ? deviceNoteText : userNoteText).value.trim();
  if (!zen?.memory || !text) {
    return;
  }
  memory.value = await zen.memory.addNote(scope, text);
  (scope === "device" ? deviceNoteText : userNoteText).value = "";
}

async function removeNote() {
  const zen = window.zen;
  const target = pendingDelete.value;
  if (!zen?.memory || !target) {
    return;
  }
  deleteBusy.value = true;
  try {
    memory.value = await zen.memory.removeNote(target.scope, target.id);
    pendingDelete.value = null;
  } finally {
    deleteBusy.value = false;
  }
}

async function recollect() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memoryBusy.value = true;
  try {
    memory.value = await zen.memory.collect();
  } finally {
    memoryBusy.value = false;
  }
}

// ---------- 飞书桥接：开关走 AgentSettings.larkBridge，状态来自 lark:status / lark:changed ----------
const LARK_GATEWAY_LABELS: Record<LarkGatewayState, string> = {
  off: "未启动",
  starting: "启动中",
  ready: "运行中",
  error: "异常",
};

const gatewayLabel = computed(() =>
  larkStatus.value ? LARK_GATEWAY_LABELS[larkStatus.value.gateway] : "",
);

function setLarkEnabled(enabled: boolean) {
  void agentStore.updateSettings({ larkBridge: { ...settings.value.larkBridge, enabled } });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 权限模式 -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <ShieldCheck :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">权限管理</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        控制读写文件、执行终端、访问网络等操作是否需要你逐次确认。
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        <Button
          v-for="item in PERMISSION_MODES"
          :key="item.id"
          variant="ghost"
          class="h-auto flex flex-col whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.permissionMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.permissionMode === item.id"
          @click="pickMode(item.id)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ item.label }}
            </span>
            <Badge v-if="item.id === 'full'" variant="secondary" class="text-[10px]">高危</Badge>
          </div>
          <p class="m-0 mt-1 text-[11.5px] leading-snug text-[var(--color-mut)]">
            {{ item.description }}
          </p>
        </Button>
      </div>
      <div
        v-if="settings.permissionMode === 'full'"
        class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11.5px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
        完全访问权限下，Agent 可以不经确认执行任何命令与写操作。请仅在完全信任的项目中使用。
      </div>
    </section>

    <!-- 项目隔离区 -->
    <section class="flex flex-col gap-2.5">
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">项目隔离区</h3>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        隔离模式下，项目会复制到 <code
          class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
        >{{ sandboxDir || '~/.zen/sandbox' }}</code> 下操作，源目录不受影响。
      </p>
      <div class="flex gap-2">
        <Button
          v-for="item in [
            { id: 'direct' as SandboxMode, label: '直接在项目目录操作', desc: '适合自己的项目，速度最快' },
            { id: 'isolated' as SandboxMode, label: '在隔离区操作', desc: '适合不熟悉的仓库，保护源目录' },
          ]"
          :key="item.id"
          variant="ghost"
          class="h-auto flex flex-col flex-1 whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.sandboxMode === item.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.sandboxMode === item.id"
          @click="pickSandbox(item.id)"
        >
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ item.label }}</span>
          <p class="m-0 mt-1 text-[11.5px] text-[var(--color-mut)]">{{ item.desc }}</p>
        </Button>
      </div>
      <div
        v-if="settings.sandboxMode === 'isolated' && currentProject"
        class="flex items-center gap-2 text-[12px] text-[var(--color-mut)]"
      >
        <span class="min-w-0 flex-1 truncate">
          当前项目：{{ currentProject.name }}（已有隔离副本时直接复用）
        </span>
        <Button variant="outline" size="sm" :disabled="rebuildBusy" @click="rebuild">
          <RefreshCw :size="13" data-icon="inline-start" />重建隔离区
        </Button>
      </div>
      <p v-if="rebuildMessage" class="m-0 text-[11.5px] text-[var(--color-mut)]">
        {{ rebuildMessage }}
      </p>
      <p v-if="chatStore.appInfo" class="m-0 text-[11px] text-[var(--color-dim)]">
        提示：隔离区不会复制 node_modules、.git 等生成物；需要时在会话里让 Agent 重新安装依赖。
      </p>
    </section>

    <!-- 记忆：设备环境 + 用户习惯（~/.zen/memory） -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <Brain :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">记忆</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        每次会话自动带上设备环境与用户习惯，Agent 不必重复探测路径和命令；也可以在对话里让它「记住……」。
      </p>

      <!-- 设备环境快照 -->
      <div
        v-if="memory?.device"
        class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-[12.5px] font-medium text-[var(--color-txt-strong)]">
            设备环境快照
          </span>
          <span class="text-[11px] text-[var(--color-dim)]">
            采集于 {{ formatTime(memory.device.collectedAt) }}
          </span>
          <Button variant="outline" size="sm" :disabled="memoryBusy" @click="recollect">
            <RefreshCw :size="13" data-icon="inline-start" />重新采集
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--color-mut)]">
          <span>系统：{{ memory.device.platform }} {{ memory.device.arch }}</span>
          <span class="min-w-0 truncate">Shell：{{ memory.device.shell }}</span>
          <span v-if="memory.device.timezone">
            时区：{{ memory.device.timezone }}{{ memory.device.locale ? ` · ${memory.device.locale}` : "" }}
          </span>
          <span class="min-w-0 truncate">用户目录：{{ memory.device.home }}</span>
        </div>
        <div v-if="deviceTools.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="[name, path] in deviceTools"
            :key="name"
            class="inline-flex max-w-full items-baseline gap-1 rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-mut)]"
            :title="`${name} = ${path}`"
          >
            <span class="font-[family-name:var(--font-mono)] text-[var(--color-txt)]">{{ name }}</span>
            <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ path }}</span>
          </span>
        </div>

        <!-- 设备备注 -->
        <div class="flex flex-col gap-1.5 border-t border-[var(--color-line-soft)] pt-2">
          <span class="text-[11.5px] text-[var(--color-mut)]">设备备注</span>
          <p v-if="!deviceNoteList.length" class="m-0 text-[11px] text-[var(--color-dim)]">
            暂无备注；可记录「这个机器上全局依赖用 pnpm」之类的长期事实。
          </p>
          <div
            v-for="note in deviceNoteList"
            :key="note.id"
            class="group flex items-start gap-2 text-[11.5px] text-[var(--color-txt)]"
          >
            <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
            <DangerIconButton
              label="删除设备备注"
              class="opacity-0 group-hover:opacity-100"
              @click="pendingDelete = { scope: 'device', id: note.id, text: note.text }"
            >
              <X :size="13" />
            </DangerIconButton>
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <Input
              v-model="deviceNoteText"
              variant="ghost"
              class="h-8 text-[12px]"
              placeholder="补充设备环境信息，回车保存"
              @keydown.enter.prevent="addNote('device')"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              aria-label="添加设备备注"
              :disabled="!deviceNoteText.trim()"
              @click="addNote('device')"
            >
              <Plus :size="14" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 用户习惯备注 -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">用户习惯</span>
        <p v-if="!userNoteList.length" class="m-0 text-[11px] text-[var(--color-dim)]">
          暂无记录；Agent 会在你明确要求记住，或你表达稳定偏好时写入。
        </p>
        <div
          v-for="note in userNoteList"
          :key="note.id"
          class="group flex items-start gap-2 text-[11.5px] text-[var(--color-txt)]"
        >
          <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
          <DangerIconButton
            label="删除用户习惯"
            class="opacity-0 group-hover:opacity-100"
            @click="pendingDelete = { scope: 'user', id: note.id, text: note.text }"
          >
            <X :size="13" />
          </DangerIconButton>
        </div>
        <div class="mt-0.5 flex items-center gap-1.5">
          <Input
            v-model="userNoteText"
            variant="ghost"
            class="h-8 text-[12px]"
            placeholder="补充你的偏好或习惯，回车保存"
            @keydown.enter.prevent="addNote('user')"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            aria-label="添加用户习惯"
            :disabled="!userNoteText.trim()"
            @click="addNote('user')"
          >
            <Plus :size="14" />
          </Button>
        </div>
      </div>
    </section>

    <!-- 飞书桥接：本机 lark-cli 网关（启停与 allowedOpenId 由主进程托管） -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <Bot :size="15" class="text-[var(--color-mut)]" />
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">飞书桥接</h3>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        通过本机已登录的 lark-cli 收发：会话列表查询、运行状态、askUser 问询推送与回复。
      </p>
      <div
        class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2.5"
      >
        <div class="flex flex-col gap-0.5">
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">启用飞书桥接</span>
          <span class="text-[11.5px] text-[var(--color-mut)]">
            开启后主进程自动拉起 lark-cli 网关并解析允许的用户
          </span>
        </div>
        <Switch
          :model-value="settings.larkBridge.enabled"
          aria-label="启用飞书桥接"
          @update:model-value="(next) => setLarkEnabled(next === true)"
        />
      </div>
      <div
        v-if="larkStatus"
        class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3"
      >
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--color-mut)]">
          <span v-if="!larkStatus.auth.available">
            未找到 lark-cli，请先安装并 lark-cli auth login
          </span>
          <template v-else>
            <span>账号：{{ larkStatus.auth.userName ?? "未知用户" }}</span>
            <span
              v-if="larkStatus.auth.appId"
              class="min-w-0 truncate font-[family-name:var(--font-mono)]"
              :title="larkStatus.auth.appId"
            >
              App ID：{{ larkStatus.auth.appId }}
            </span>
          </template>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--color-mut)]">
          <span>网关：{{ gatewayLabel }}</span>
          <span v-if="larkStatus.settings.allowedOpenId">
            已绑定：{{ larkStatus.auth.userName ?? larkStatus.settings.allowedOpenId }}
          </span>
        </div>
        <p v-if="larkStatus.gatewayError" class="m-0 text-[11.5px] text-[var(--color-err)]">
          {{ larkStatus.gatewayError }}
        </p>
      </div>
      <p class="m-0 text-[11px] text-[var(--color-dim)]">
        飞书里给机器人发『列表』『状态』查看会话；问询会推送到飞书，直接回复即可写回会话。
      </p>
    </section>

    <!-- 删除备注二次确认（会落库的删除） -->
    <ConfirmDialog
      :open="pendingDelete != null"
      :title="pendingDelete?.scope === 'user' ? '删除这条用户习惯？' : '删除这条设备备注？'"
      :description="`「${pendingDelete?.text ?? ''}」将从记忆中移除，后续会话不再携带。`"
      confirm-label="删除"
      :pending="deleteBusy"
      @update:open="(next) => { if (!next) pendingDelete = null; }"
      @confirm="removeNote"
    />
  </div>
</template>
