<script setup lang="ts">
import { Download, Pencil, Plus, RefreshCw, ScanSearch, Trash2, Wand2, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import { MCP_SERVER_PRESETS } from "@zen/shared";

import type { McpDiscoveredServer, McpServerConfig, McpServerPreset, McpTransport } from "@zen/shared";

/**
 * MCP 服务：stdio 本地子进程 / SSE 旧版远程 / Streamable HTTP 新版远程。
 * 预设目录覆盖官方与知名托管服务，选中即预填，占位参数由用户补全；
 * 也可扫描当前仓库与系统里已有的 MCP 配置（Claude Code / Desktop / Cursor 等）一键导入。
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { mcpStatuses } = storeToRefs(agentStore);

const form = ref<{
  name: string;
  transport: McpTransport;
  command: string;
  env: string;
  url: string;
  headers: string;
}>({
  name: "",
  transport: "stdio",
  command: "",
  env: "",
  url: "",
  headers: "",
});

// 正在编辑的服务 id；null 表示表单处于「添加」模式
const editingId = ref<string | null>(null);

const appliedPreset = ref<McpServerPreset | null>(null);
const formError = ref("");
const scanBusy = ref(false);
const scanned = ref<McpDiscoveredServer[]>([]);
const scannedNote = ref("");

const mcpServers = computed<McpServerConfig[]>(
  () => mcpStatuses.value.map((item) => item.config),
);

const presetRequires = computed(() => appliedPreset.value?.requires ?? []);

onMounted(() => {
  void agentStore.refreshMcp();
});

function applyPreset(preset: McpServerPreset) {
  appliedPreset.value = preset;
  formError.value = "";
  form.value = {
    name: preset.name,
    transport: preset.transport,
    command: preset.command ? [preset.command, ...(preset.args ?? [])].join(" ") : "",
    env: "",
    url: preset.url ?? "",
    headers: "",
  };
}

function setTransport(transport: McpTransport) {
  form.value.transport = transport;
  appliedPreset.value = null;
}

/** 把表单解析成 McpServerConfig；添加与编辑共用，id 由调用方决定 */
function buildConfigFromForm(): { config: McpServerConfig } | { error: string } {
  const name = form.value.name.trim();
  if (!name) {
    return { error: t("settings.mcp.errName") };
  }
  const base = {
    id: `${name}-${Date.now().toString(36)}`,
    name,
    transport: form.value.transport,
    enabled: true,
  };
  if (form.value.transport === "stdio") {
    const commandLine = form.value.command.trim();
    if (!commandLine) {
      return { error: t("settings.mcp.errCommand") };
    }
    const [cmd, ...args] = commandLine.split(/\s+/);
    let env: Record<string, string> | undefined;
    const envRaw = form.value.env.trim();
    if (envRaw) {
      try {
        env = JSON.parse(envRaw) as Record<string, string>;
      } catch {
        return { error: t("settings.mcp.errEnvJson") };
      }
    }
    return { config: { ...base, command: cmd ?? commandLine, args, env } };
  }
  const url = form.value.url.trim();
  if (!/^https?:\/\//.test(url)) {
    return { error: t("settings.mcp.errUrl") };
  }
  let headers: Record<string, string> | undefined;
  const raw = form.value.headers.trim();
  if (raw) {
    try {
      headers = JSON.parse(raw) as Record<string, string>;
    } catch {
      return { error: t("settings.mcp.errHeadersJson") };
    }
  }
  return { config: { ...base, url, headers } };
}

function resetForm() {
  form.value = { name: "", transport: "stdio", command: "", env: "", url: "", headers: "" };
  appliedPreset.value = null;
  formError.value = "";
}

async function addServer() {
  const parsed = buildConfigFromForm();
  if ("error" in parsed) {
    formError.value = parsed.error;
    return;
  }
  formError.value = "";
  await agentStore.saveMcpServers([...mcpServers.value, parsed.config]);
  await agentStore.refreshMcp();
  appliedPreset.value = null;
  resetForm();
}

/** 编辑既有服务（含扫描导入的）：表单预填，保存时保留 id / enabled，其余字段以表单为准 */
function startEdit(config: McpServerConfig) {
  editingId.value = config.id;
  appliedPreset.value = null;
  formError.value = "";
  form.value = {
    name: config.name,
    transport: config.transport,
    command:
      config.transport === "stdio"
        ? [config.command ?? "", ...(config.args ?? [])].filter(Boolean).join(" ")
        : "",
    env: config.env ? JSON.stringify(config.env, null, 2) : "",
    url: config.url ?? "",
    headers: config.headers ? JSON.stringify(config.headers, null, 2) : "",
  };
}

function cancelEdit() {
  editingId.value = null;
  resetForm();
}

async function saveEdit() {
  const target = mcpServers.value.find((item) => item.id === editingId.value);
  if (!target) {
    cancelEdit();
    return;
  }
  const parsed = buildConfigFromForm();
  if ("error" in parsed) {
    formError.value = parsed.error;
    return;
  }
  formError.value = "";
  await agentStore.saveMcpServers(
    mcpServers.value.map((item) =>
      item.id === target.id
        ? { ...parsed.config, id: target.id, enabled: target.enabled }
        : item,
    ),
  );
  await agentStore.refreshMcp();
  cancelEdit();
}

async function submitForm() {
  if (editingId.value) {
    await saveEdit();
  } else {
    await addServer();
  }
}

async function toggleServer(config: McpServerConfig) {
  await agentStore.saveMcpServers(
    mcpServers.value.map((item) =>
      item.id === config.id ? { ...item, enabled: !item.enabled } : item,
    ),
  );
  await agentStore.refreshMcp();
}

async function removeServer(config: McpServerConfig) {
  await agentStore.saveMcpServers(mcpServers.value.filter((item) => item.id !== config.id));
  await agentStore.refreshMcp();
}

/** 扫描当前仓库与系统里已有的 MCP 配置 */
async function runScan() {
  scanBusy.value = true;
  scannedNote.value = "";
  try {
    const workspaceRoot =
      workspaceStore.pathOf(chatStore.sessionWorkspaceId) || workspaceStore.activePath;
    const found = await agentStore.scanMcp(workspaceRoot);
    scanned.value = found;
    const imported = found.filter((item) => !item.alreadyImported).length;
    scannedNote.value = found.length
      ? t("settings.mcp.scanFound", { total: found.length, count: imported })
      : t("settings.mcp.scanNone");
  } finally {
    scanBusy.value = false;
  }
}

async function importDiscovered(item: McpDiscoveredServer) {
  if (item.alreadyImported) {
    return;
  }
  await agentStore.saveMcpServers([
    ...mcpServers.value,
    { ...item.config, id: `${item.config.name}-${Date.now().toString(36)}` },
  ]);
  await agentStore.refreshMcp();
  // 更新本条扫描结果为已导入
  scanned.value = scanned.value.map((found) =>
    found.sourcePath === item.sourcePath && found.config.name === item.config.name
      ? { ...found, alreadyImported: true }
      : found,
  );
  scannedNote.value = t("settings.mcp.importedNote", { name: item.config.name });
}

function stateBadge(state: string): "secondary" | "outline" | "default" {
  if (state === "running") {
    return "default";
  }
  if (state === "error") {
    return "secondary";
  }
  return "outline";
}

function stateLabel(state: string): string {
  if (state === "running") {
    return t("settings.mcp.state.running");
  }
  if (state === "error") {
    return t("settings.mcp.state.error");
  }
  if (state === "starting") {
    return t("settings.mcp.state.starting");
  }
  return t("settings.mcp.state.stopped");
}

const transportLabel = (transport: McpTransport): string => t(`settings.mcp.transport.${transport}`);

function endpointText(config: McpServerConfig): string {
  if (config.transport === "stdio") {
    return [config.command, ...(config.args ?? [])].join(" ");
  }
  return config.url ?? "";
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.mcp.introA") }}<code
        class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
      >{{ t("settings.mcp.toolPattern") }}</code>{{ t("settings.mcp.introB") }}
    </p>

    <!-- 预设目录 -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
          {{ t("settings.mcp.presetsTitle") }}
        </h3>
        <Button variant="ghost" size="sm" @click="agentStore.refreshMcp()">
          <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.mcp.reconnect") }}
        </Button>
      </div>
      <p class="m-0 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.mcp.presetsDesc") }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Button
          v-for="preset in MCP_SERVER_PRESETS"
          :key="preset.id"
          variant="ghost"
          class="group h-auto flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-left text-[11px] font-normal text-[var(--color-mut)] transition-colors hover:border-[var(--color-txt-dim)] hover:text-[var(--color-txt)] hover:bg-transparent dark:hover:bg-transparent"
          :title="`${preset.description}${preset.requires?.length ? `（${preset.requires.join('；')}）` : ''}`"
          @click="applyPreset(preset)"
        >
          <Wand2 :size="11" class="flex-none opacity-60 group-hover:opacity-100" />
          <span class="font-medium">{{ preset.name }}</span>
          <span class="text-[10px] text-[var(--color-dim)]">
            {{ transportLabel(preset.transport) }}
          </span>
        </Button>
      </div>
    </section>

    <!-- 扫描已有配置 -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
          {{ t("settings.mcp.scanTitle") }}
        </h3>
        <Button variant="ghost" size="sm" :disabled="scanBusy" @click="runScan">
          <ScanSearch :size="13" data-icon="inline-start" />
          {{ scanBusy ? t("settings.mcp.scanning") : t("settings.mcp.scan") }}
        </Button>
      </div>
      <p class="m-0 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.mcp.scanDesc") }}
      </p>
      <p v-if="scannedNote" class="m-0 text-[11px] text-[var(--color-mut)]">
        {{ scannedNote }}
      </p>
      <div v-if="scanned.length" class="flex flex-col gap-1">
        <div
          v-for="item in scanned"
          :key="`${item.sourcePath}-${item.config.name}`"
          class="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2.5 py-1.5"
        >
          <span class="text-[12px] font-medium text-[var(--color-txt)]">{{ item.config.name }}</span>
          <Badge variant="outline" class="flex-none text-[10px]">{{ item.source }}</Badge>
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
            :title="item.sourcePath"
          >
            {{ endpointText(item.config) }}
          </span>
          <Button
            v-if="!item.alreadyImported"
            variant="ghost"
            size="sm"
            :aria-label="t('settings.mcp.importAria', { name: item.config.name })"
            @click="importDiscovered(item)"
          >
            <Download :size="12" data-icon="inline-start" />{{ t("settings.mcp.import") }}
          </Button>
          <Badge v-else variant="secondary" class="flex-none text-[10px]">{{ t("settings.mcp.importedTag") }}</Badge>
        </div>
      </div>
    </section>

    <!-- 添加表单 -->
    <section class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
          {{ editingId ? t("settings.mcp.editService") : t("settings.mcp.addService") }}
        </h3>
        <Badge v-if="appliedPreset" variant="secondary" class="text-[10px]">
          {{ t("settings.mcp.presetBadge", { name: appliedPreset.name }) }}
        </Badge>
      </div>
      <p v-if="appliedPreset" class="m-0 text-[11px] text-[var(--color-mut)]">
        {{ appliedPreset.description }}
        <template v-if="presetRequires.length">（{{ presetRequires.join("；") }}）</template>
      </p>

      <div class="flex items-start gap-2">
        <div class="flex w-40 flex-none flex-col gap-1.5">
          <Input
            v-model="form.name"
            class="h-8 bg-[var(--color-np-btn-bg)] text-[12px]"
            :placeholder="t('settings.mcp.namePlaceholder')"
          />
          <Select
            :model-value="form.transport"
            @update:model-value="(value) => setTransport(value as McpTransport)"
          >
            <SelectTrigger class="h-8 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="stdio">{{ t("settings.mcp.transportStdioOption") }}</SelectItem>
                <SelectItem value="http">{{ t("settings.mcp.transportHttpOption") }}</SelectItem>
                <SelectItem value="sse">{{ t("settings.mcp.transportSseOption") }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <template v-if="form.transport === 'stdio'">
            <Input
              v-model="form.command"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              :placeholder="t('settings.mcp.commandPlaceholder')"
              @keydown.enter="submitForm"
            />
            <Input
              v-model="form.env"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              :placeholder="t('settings.mcp.envPlaceholder')"
              @keydown.enter="submitForm"
            />
          </template>
          <template v-else>
            <Input
              v-model="form.url"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              :placeholder="form.transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'"
              @keydown.enter="submitForm"
            />
            <Input
              v-model="form.headers"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              :placeholder="t('settings.mcp.headersPlaceholder')"
              @keydown.enter="submitForm"
            />
          </template>
        </div>

        <Button variant="outline" size="sm" class="flex-none" @click="submitForm">
          <Plus v-if="!editingId" :size="13" data-icon="inline-start" />{{ editingId ? t("common.save") : t("settings.mcp.addBtn") }}
        </Button>
        <Button v-if="editingId" variant="ghost" size="sm" class="flex-none" @click="cancelEdit">
          <X :size="13" data-icon="inline-start" />{{ t("common.cancel") }}
        </Button>
      </div>
      <p v-if="formError" class="m-0 text-[11px] text-[var(--color-err)]">{{ formError }}</p>
    </section>

    <!-- 服务列表 -->
    <section class="flex flex-col gap-1.5">
      <div
        v-for="item in mcpStatuses"
        :key="item.config.id"
        class="rounded-xl border border-[var(--color-line)] px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ item.config.name }}
          </span>
          <Badge variant="outline" class="text-[10px]">
            {{ transportLabel(item.config.transport) }}
          </Badge>
          <Badge :variant="stateBadge(item.state)" class="text-[10px]">
            {{ stateLabel(item.state) }}
          </Badge>
          <span class="min-w-0 flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('settings.mcp.editAria', { name: item.config.name })"
            @click="startEdit(item.config)"
          >
            <Pencil :size="13" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="item.config.enabled ? t('settings.mcp.disable') : t('settings.mcp.enable')"
            @click="toggleServer(item.config)"
          >
            {{ item.config.enabled ? t("settings.mcp.disable") : t("settings.mcp.enable") }}
          </Button>
          <Button variant="ghost" size="icon-sm" :aria-label="t('settings.mcp.deleteAria')" @click="removeServer(item.config)">
            <Trash2 :size="13" />
          </Button>
        </div>
        <p
          class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
        >
          {{ endpointText(item.config) }}
        </p>
        <p v-if="item.tools.length" class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">
          {{ t("settings.mcp.toolsCount", { count: item.tools.length, list: item.tools.map((tool) => tool.name).join("、") }) }}
        </p>
        <p v-if="item.error" class="m-0 mt-0.5 text-[11px] text-[var(--color-err)]">
          {{ item.error }}
        </p>
      </div>
      <p v-if="!mcpStatuses.length" class="m-0 text-[12px] text-[var(--color-dim)]">
        {{ t("settings.mcp.emptyHint") }}
      </p>
    </section>
  </div>
</template>
