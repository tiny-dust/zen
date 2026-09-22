<script setup lang="ts">
import { Download, Plus, RefreshCw, ScanSearch, Trash2, Wand2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

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
const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { mcpStatuses } = storeToRefs(agentStore);

const form = ref<{
  name: string;
  transport: McpTransport;
  command: string;
  url: string;
  headers: string;
}>({
  name: "",
  transport: "stdio",
  command: "",
  url: "",
  headers: "",
});

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
    url: preset.url ?? "",
    headers: "",
  };
}

function setTransport(transport: McpTransport) {
  form.value.transport = transport;
  appliedPreset.value = null;
}

async function addServer() {
  const name = form.value.name.trim();
  if (!name) {
    formError.value = "请填写服务名称";
    return;
  }
  const base = {
    id: `${name}-${Date.now().toString(36)}`,
    name,
    transport: form.value.transport,
    enabled: true,
  };
  let config: McpServerConfig;
  if (form.value.transport === "stdio") {
    const commandLine = form.value.command.trim();
    if (!commandLine) {
      formError.value = "请填写启动命令";
      return;
    }
    const [cmd, ...args] = commandLine.split(/\s+/);
    config = { ...base, command: cmd ?? commandLine, args };
  } else {
    const url = form.value.url.trim();
    if (!/^https?:\/\//.test(url)) {
      formError.value = "请填写 http(s):// 开头的服务地址";
      return;
    }
    let headers: Record<string, string> | undefined;
    const raw = form.value.headers.trim();
    if (raw) {
      try {
        headers = JSON.parse(raw) as Record<string, string>;
      } catch {
        formError.value = "请求头不是合法 JSON，例如 {\"Authorization\":\"Bearer xxx\"}";
        return;
      }
    }
    config = { ...base, url, headers };
  }

  formError.value = "";
  await agentStore.saveMcpServers([...mcpServers.value, config]);
  await agentStore.refreshMcp();
  appliedPreset.value = null;
  form.value = { name: "", transport: "stdio", command: "", url: "", headers: "" };
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
      ? `发现 ${found.length} 个服务，其中 ${imported} 个未导入`
      : "没有在当前仓库或系统里发现 MCP 配置";
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
  scannedNote.value = `已导入 ${item.config.name}`;
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
    return "运行中";
  }
  if (state === "error") {
    return "异常";
  }
  if (state === "starting") {
    return "启动中";
  }
  return "已停止";
}

const transportLabel: Record<McpTransport, string> = {
  stdio: "stdio 本地",
  sse: "SSE 旧版",
  http: "HTTP 新版",
};

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
      工具会以 <code
        class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
      >mcp.服务器.工具</code> 的形式接入 Agent；配置持久化在 ~/.zen/mcp.json。支持
      stdio 本地进程、SSE 旧版远程与 Streamable HTTP 新版远程三种传输。
    </p>

    <!-- 预设目录 -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
          知名服务预设
        </h3>
        <Button variant="ghost" size="sm" @click="agentStore.refreshMcp()">
          <RefreshCw :size="13" data-icon="inline-start" />重新连接
        </Button>
      </div>
      <p class="m-0 text-[11.5px] text-[var(--color-dim)]">
        点击即预填表单；带 {path}/{token} 占位或需 OAuth 的服务，补全后添加。
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Button
          v-for="preset in MCP_SERVER_PRESETS"
          :key="preset.id"
          variant="ghost"
          class="group h-auto flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-left text-[11.5px] font-normal text-[var(--color-mut)] transition-colors hover:border-[var(--color-txt-dim)] hover:text-[var(--color-txt)] hover:bg-transparent dark:hover:bg-transparent"
          :title="`${preset.description}${preset.requires?.length ? `（${preset.requires.join('；')}）` : ''}`"
          @click="applyPreset(preset)"
        >
          <Wand2 :size="11" class="flex-none opacity-60 group-hover:opacity-100" />
          <span class="font-medium">{{ preset.name }}</span>
          <span class="text-[10px] text-[var(--color-dim)]">
            {{ transportLabel[preset.transport] }}
          </span>
        </Button>
      </div>
    </section>

    <!-- 扫描已有配置 -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
          扫描已有服务
        </h3>
        <Button variant="ghost" size="sm" :disabled="scanBusy" @click="runScan">
          <ScanSearch :size="13" data-icon="inline-start" />
          {{ scanBusy ? "扫描中…" : "扫描当前仓库与系统" }}
        </Button>
      </div>
      <p class="m-0 text-[11.5px] text-[var(--color-dim)]">
        检查当前仓库的 .mcp.json / .vscode/mcp.json，以及 Claude Code、Claude Desktop、Cursor、
        Windsurf、VS Code 的用户级配置，发现后可一键导入。
      </p>
      <p v-if="scannedNote" class="m-0 text-[11.5px] text-[var(--color-mut)]">
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
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
            :title="item.sourcePath"
          >
            {{ endpointText(item.config) }}
          </span>
          <Button
            v-if="!item.alreadyImported"
            variant="ghost"
            size="sm"
            :aria-label="`导入 ${item.config.name}`"
            @click="importDiscovered(item)"
          >
            <Download :size="12" data-icon="inline-start" />导入
          </Button>
          <Badge v-else variant="secondary" class="flex-none text-[10px]">已导入</Badge>
        </div>
      </div>
    </section>

    <!-- 添加表单 -->
    <section class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">添加服务</h3>
        <Badge v-if="appliedPreset" variant="secondary" class="text-[10px]">
          预设：{{ appliedPreset.name }}
        </Badge>
      </div>
      <p v-if="appliedPreset" class="m-0 text-[11.5px] text-[var(--color-mut)]">
        {{ appliedPreset.description }}
        <template v-if="presetRequires.length">（{{ presetRequires.join("；") }}）</template>
      </p>

      <div class="flex items-start gap-2">
        <div class="flex w-40 flex-none flex-col gap-1.5">
          <Input
            v-model="form.name"
            class="h-8 bg-[var(--color-np-btn-bg)] text-[12px]"
            placeholder="名称"
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
                <SelectItem value="stdio">stdio 本地进程</SelectItem>
                <SelectItem value="http">HTTP 新版（Streamable）</SelectItem>
                <SelectItem value="sse">SSE 旧版</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <template v-if="form.transport === 'stdio'">
            <Input
              v-model="form.command"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              placeholder="启动命令，如 npx -y @modelcontextprotocol/server-filesystem ~/docs"
              @keydown.enter="addServer"
            />
          </template>
          <template v-else>
            <Input
              v-model="form.url"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              :placeholder="form.transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'"
              @keydown.enter="addServer"
            />
            <Input
              v-model="form.headers"
              class="h-8 bg-[var(--color-np-btn-bg)] font-[family-name:var(--font-mono)] text-[12px]"
              placeholder='附加请求头（JSON，可选），如 {"Authorization":"Bearer xxx"}'
              @keydown.enter="addServer"
            />
          </template>
        </div>

        <Button variant="outline" size="sm" class="flex-none" @click="addServer">
          <Plus :size="13" data-icon="inline-start" />添加
        </Button>
      </div>
      <p v-if="formError" class="m-0 text-[11.5px] text-[var(--color-err)]">{{ formError }}</p>
    </section>

    <!-- 服务列表 -->
    <section class="flex flex-col gap-1.5">
      <div
        v-for="item in mcpStatuses"
        :key="item.config.id"
        class="rounded-xl border border-[var(--color-line)] px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
            {{ item.config.name }}
          </span>
          <Badge variant="outline" class="text-[10px]">
            {{ transportLabel[item.config.transport] }}
          </Badge>
          <Badge :variant="stateBadge(item.state)" class="text-[10px]">
            {{ stateLabel(item.state) }}
          </Badge>
          <span class="min-w-0 flex-1" />
          <Button
            variant="ghost"
            size="sm"
            :aria-label="item.config.enabled ? '禁用' : '启用'"
            @click="toggleServer(item.config)"
          >
            {{ item.config.enabled ? "禁用" : "启用" }}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="删除" @click="removeServer(item.config)">
            <Trash2 :size="13" />
          </Button>
        </div>
        <p
          class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
        >
          {{ endpointText(item.config) }}
        </p>
        <p v-if="item.tools.length" class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">
          {{ item.tools.length }} 个工具：{{ item.tools.map((tool) => tool.name).join("、") }}
        </p>
        <p v-if="item.error" class="m-0 mt-0.5 text-[11px] text-[var(--color-err)]">
          {{ item.error }}
        </p>
      </div>
      <p v-if="!mcpStatuses.length" class="m-0 text-[12px] text-[var(--color-dim)]">
        还没有接入 MCP 服务。从上面的预设选一个，或手动填写配置。
      </p>
    </section>
  </div>
</template>
