<script setup lang="ts">
import { Bot, Check, CircleAlert, Download, Pencil, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/stores/agent";

import type { LarkGatewayState, LarkQuickCommand } from "@zen/shared";

/**
 * 飞书桥接：开关走 AgentSettings.larkBridge，状态来自 lark:status / lark:changed
 */
const agentStore = useAgentStore();
const { larkStatus, settings } = storeToRefs(agentStore);

const LARK_GATEWAY_LABELS: Record<LarkGatewayState, string> = {
  off: "未启动",
  starting: "启动中",
  ready: "运行中",
  error: "异常",
};

const gatewayLabel = computed(() =>
  larkStatus.value ? LARK_GATEWAY_LABELS[larkStatus.value.gateway] : "",
);
const checking = ref(false);
const installing = ref(false);
const testing = ref(false);
const testHint = ref<string | null>(null);
const actionError = ref<string | null>(null);

onMounted(() => {
  if (!larkStatus.value) {
    void refreshStatus();
  }
});

async function refreshStatus() {
  if (!window.zen?.lark) {
    return;
  }
  checking.value = true;
  actionError.value = null;
  try {
    larkStatus.value = await window.zen.lark.status(true);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "检查飞书状态失败";
  } finally {
    checking.value = false;
  }
}

async function installCli() {
  if (!window.zen?.lark) {
    return;
  }
  installing.value = true;
  actionError.value = null;
  try {
    const result = await window.zen.lark.installCli();
    if (!result.ok) {
      actionError.value = result.error ?? "安装 lark-cli 失败";
      return;
    }
    await refreshStatus();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "安装 lark-cli 失败";
  } finally {
    installing.value = false;
  }
}

function setLarkEnabled(enabled: boolean) {
  void agentStore.updateSettings({ larkBridge: { ...settings.value.larkBridge, enabled } });
}

async function sendTestAskCard() {
  if (!window.zen?.lark) {
    return;
  }
  testing.value = true;
  testHint.value = null;
  try {
    const result = await window.zen.lark.testAskCard();
    testHint.value = result.ok
      ? "测试卡片已发送到飞书；点击卡片按钮，若回执「该问询已失效」说明按钮回调已通。"
      : (result.error ?? "发送测试卡片失败");
  } catch (error) {
    testHint.value = error instanceof Error ? error.message : "发送测试卡片失败";
  } finally {
    testing.value = false;
  }
}

// ---------- 自定义快捷命令（/别名 → 预设文本；菜单卡片一键点选） ----------
const quickForm = ref({ alias: "", label: "", prompt: "" });
const editingQuickId = ref<string | null>(null);
const quickHint = ref<string | null>(null);

const quickCommands = computed(() => settings.value.larkBridge.quickCommands ?? []);

function saveQuickCommands(next: LarkQuickCommand[]) {
  void agentStore.updateSettings({
    larkBridge: { ...settings.value.larkBridge, quickCommands: next },
  });
}

function startEditQuick(item: LarkQuickCommand) {
  editingQuickId.value = item.id;
  quickForm.value = { alias: item.alias, label: item.label, prompt: item.prompt };
  quickHint.value = null;
}

function cancelEditQuick() {
  editingQuickId.value = null;
  quickForm.value = { alias: "", label: "", prompt: "" };
  quickHint.value = null;
}

function submitQuickCommand() {
  const alias = quickForm.value.alias.trim().replace(/^\/+/, "");
  const prompt = quickForm.value.prompt.trim();
  if (!alias || !prompt) {
    quickHint.value = "别名与预设内容不能为空";
    return;
  }
  if (!/^[^\s/]+$/.test(alias)) {
    quickHint.value = "别名不能含空格或斜杠";
    return;
  }
  const duplicated = quickCommands.value.some(
    (item) => item.alias.toLowerCase() === alias.toLowerCase() && item.id !== editingQuickId.value,
  );
  if (duplicated) {
    quickHint.value = `别名 /${alias} 已存在`;
    return;
  }
  const entry: LarkQuickCommand = {
    id: editingQuickId.value ?? `qc-${Date.now()}`,
    alias,
    label: quickForm.value.label.trim() || alias,
    prompt,
  };
  const next = editingQuickId.value
    ? quickCommands.value.map((item) => (item.id === editingQuickId.value ? entry : item))
    : [...quickCommands.value, entry];
  saveQuickCommands(next);
  cancelEditQuick();
}

function removeQuickCommand(id: string) {
  saveQuickCommands(quickCommands.value.filter((item) => item.id !== id));
  if (editingQuickId.value === id) {
    cancelEditQuick();
  }
}
</script>

<template>
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
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">启用飞书桥接</span>
        <span class="text-[11px] text-[var(--color-mut)]">
          开启后主进程自动拉起 lark-cli 网关并解析允许的用户
        </span>
      </div>
      <Switch
        :model-value="settings.larkBridge.enabled"
        aria-label="启用飞书桥接"
        @update:model-value="(next) => setLarkEnabled(next === true)"
      />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">运行前检查</span>
        <span class="text-[11px] text-[var(--color-mut)]">安装 CLI 后，还需要完成飞书账号与机器人身份授权。</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="checking || installing" @click="refreshStatus">
          <RefreshCw :size="12" :class="checking ? 'animate-spin' : ''" data-icon="inline-start" />
          {{ checking ? "检查中" : "重新检查" }}
        </Button>
        <Button
          v-if="larkStatus && !larkStatus.auth.cliInstalled"
          variant="outline"
          size="xs"
          :disabled="installing || checking"
          @click="installCli"
        >
          <Download :size="12" data-icon="inline-start" />
          {{ installing ? "安装中" : "一键安装 lark-cli" }}
        </Button>
      </div>
    </div>
    <div v-if="larkStatus" class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="grid gap-1.5 text-[11px] sm:grid-cols-2">
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.cliInstalled" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>lark-cli：{{ larkStatus.auth.cliInstalled ? `已安装${larkStatus.auth.version ? `（${larkStatus.auth.version}）` : ''}` : "未安装" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.userOpenId" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>账号：{{ larkStatus.auth.userName ?? "未登录" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.auth.botReady" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>机器人身份：{{ larkStatus.auth.botReady ? "已就绪" : "未就绪" }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Check v-if="larkStatus.gateway === 'ready'" :size="13" class="text-[var(--color-ok)]" />
          <CircleAlert v-else :size="13" class="text-[var(--color-err)]" />
          <span>网关：{{ gatewayLabel }}</span>
        </div>
      </div>
      <div v-if="larkStatus.auth.appId || larkStatus.settings.allowedOpenId" class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-mut)]">
        <span v-if="larkStatus.auth.appId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.auth.appId">
          App ID：{{ larkStatus.auth.appId }}
        </span>
        <span v-if="larkStatus.settings.allowedOpenId" class="min-w-0 truncate font-[family-name:var(--font-mono)]" :title="larkStatus.settings.allowedOpenId">
          安全绑定：{{ larkStatus.settings.allowedOpenId }}
        </span>
      </div>
      <p v-if="larkStatus.auth.error" class="m-0 text-[11px] text-[var(--color-err)]">
        {{ larkStatus.auth.error }}
      </p>
      <p v-if="larkStatus.gatewayError" class="m-0 text-[11px] text-[var(--color-err)]">
        {{ larkStatus.gatewayError }}
      </p>
    </div>
    <!-- 自定义快捷命令：/别名 触发 + 菜单卡片按钮一键点选 -->
    <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">快捷命令</span>
        <span class="text-[11px] text-[var(--color-mut)]">
          在飞书发送 /别名 触发预设内容（预设可为内置指令如「状态」或任意消息）；也显示为「菜单」卡片按钮。保存后即时生效。
        </span>
      </div>
      <div
        v-for="item in quickCommands"
        :key="item.id"
        class="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line-soft)] px-2.5 py-1.5"
      >
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-[11px] text-[var(--color-txt-strong)]">
            /{{ item.alias }}
            <span v-if="item.label && item.label !== item.alias" class="text-[var(--color-mut)]">· {{ item.label }}</span>
          </span>
          <span class="truncate text-[11px] text-[var(--color-mut)]" :title="item.prompt">{{ item.prompt }}</span>
        </div>
        <div class="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" class="size-6" aria-label="编辑快捷命令" @click="startEditQuick(item)">
            <Pencil :size="12" />
          </Button>
          <Button variant="ghost" size="icon" class="size-6" aria-label="删除快捷命令" @click="removeQuickCommand(item.id)">
            <Trash2 :size="12" />
          </Button>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="grid gap-1.5 sm:grid-cols-3">
          <Input v-model="quickForm.alias" placeholder="别名，如 review" class="h-7 text-[11px]" />
          <Input v-model="quickForm.label" placeholder="按钮名（可选）" class="h-7 text-[11px]" />
          <Input v-model="quickForm.prompt" placeholder="预设内容，如 审查当前分支改动" class="h-7 text-[11px]" />
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button size="xs" @click="submitQuickCommand">
            <Plus v-if="!editingQuickId" :size="12" data-icon="inline-start" />
            {{ editingQuickId ? "保存修改" : "添加快捷命令" }}
          </Button>
          <Button v-if="editingQuickId" variant="outline" size="xs" @click="cancelEditQuick">取消</Button>
          <span v-if="quickHint" class="min-w-0 text-[11px] text-[var(--color-err)]">{{ quickHint }}</span>
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-mut)]">
      <div class="font-medium text-[var(--color-txt-strong)]">卡片按钮回调</div>
      <div>
        问询卡片按钮依赖飞书开放平台「应用 → 事件与回调 → 回调配置」开启卡片回调（<code>card.action.trigger</code>）；未开启时按钮点击无反应（不会报错），可直接回复选项编号兑底。
      </div>
      <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Button variant="outline" size="xs" :disabled="testing" @click="sendTestAskCard">
          {{ testing ? "发送中" : "发送测试问询卡片" }}
        </Button>
        <span v-if="testHint" class="min-w-0 text-[11px]" :class="testHint.includes('已发送') ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'">
          {{ testHint }}
        </span>
      </div>
    </div>
    <div class="flex flex-col gap-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-mut)]">
      <div class="font-medium text-[var(--color-txt-strong)]">使用说明</div>
      <div>1. 点击“一键安装 lark-cli”，或在终端执行 <code>npm install -g @larksuite/cli</code>。</div>
      <div>2. 在设置的“个人资料”页点击“登录”并选择飞书完成授权；启用桥接后，Zen 会自动绑定当前账号的 open_id。</div>
      <div>3. 在飞书开放平台为应用开启机器人能力，并订阅 <code>im.message.receive_v1</code>；卡片问询还需订阅 <code>card.action.trigger</code>。</div>
      <div>4. 在飞书私聊机器人发送“帮助”查看指令；发送“列表”“状态”查看会话，普通文本会继续当前会话，无绑定会话时新建 Agent 会话。</div>
      <div>5. 只有安全绑定的账号可以操控 Zen；API Key 与登录 token 不会展示在此页。</div>
    </div>
    <p v-if="actionError" class="m-0 text-[11px] text-[var(--color-err)]">{{ actionError }}</p>
  </section>
</template>
