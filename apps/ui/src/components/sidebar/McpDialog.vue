<script setup lang="ts">
import { Download, Plus, RefreshCw, ScanSearch, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { McpDiscoveredServer, McpServerConfig, McpTransport } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { mcpStatuses } = storeToRefs(agentStore);

// 弹窗浮在内嵌浏览器之上时会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

const form = ref({
  name: "",
  transport: "stdio" as McpTransport,
  command: "",
  url: "",
});
const formError = ref("");

const mcpServers = computed<McpServerConfig[]>(() =>
  mcpStatuses.value.map((item) => item.config),
);

watch(open, (value) => {
  if (value) {
    void agentStore.refreshMcp();
  }
});

async function addServer() {
  const name = form.value.name.trim();
  if (!name) {
    formError.value = "请填写服务名称";
    return;
  }
  const base: McpServerConfig = {
    id: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`,
    name,
    transport: form.value.transport,
    enabled: true,
  };
  if (form.value.transport === "stdio") {
    const parts = form.value.command.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      formError.value = "请填写启动命令";
      return;
    }
    base.command = parts[0]!;
    base.args = parts.slice(1);
  } else {
    const url = form.value.url.trim();
    if (!url) {
      formError.value = "请填写服务 URL";
      return;
    }
    base.url = url;
  }
  await agentStore.saveMcpServers([...mcpServers.value, base]);
  form.value = { name: "", transport: "stdio", command: "", url: "" };
  formError.value = "";
}

async function removeServer(config: McpServerConfig) {
  await agentStore.saveMcpServers(mcpServers.value.filter((item) => item.id !== config.id));
}

// 扫描其它 AI 工具已配置的 MCP（Codex / Claude / Cursor / VS Code / MiMo / DimAgent 等）并一键导入
const scanBusy = ref(false);
const discovered = ref<McpDiscoveredServer[]>([]);
const scanNote = ref("");

async function runScan() {
  scanBusy.value = true;
  scanNote.value = "";
  try {
    const workspaceRoot =
      workspaceStore.pathOf(chatStore.sessionWorkspaceId) || workspaceStore.activePath;
    discovered.value = await agentStore.scanMcp(workspaceRoot);
    const pending = discovered.value.filter((item) => !item.alreadyImported).length;
    scanNote.value = discovered.value.length
      ? `发现 ${discovered.value.length} 个服务，其中 ${pending} 个未导入`
      : "未在本机其它工具或当前仓库发现 MCP 配置";
  } finally {
    scanBusy.value = false;
  }
}

/** 一键导入：沿用 mcp:set-servers 保存链路写入 ~/.zen/mcp.json；跳过已导入与重名 */
async function importDiscovered(items: McpDiscoveredServer[]) {
  const names = new Set(mcpServers.value.map((item) => item.name));
  const add: McpServerConfig[] = [];
  for (const item of items) {
    if (item.alreadyImported || names.has(item.config.name)) {
      continue;
    }
    names.add(item.config.name);
    add.push({
      ...item.config,
      id: `${item.config.name}-${Date.now().toString(36)}-${add.length}`,
      enabled: true,
    });
  }
  if (!add.length) {
    return;
  }
  await agentStore.saveMcpServers([...mcpServers.value, ...add]);
  await agentStore.refreshMcp();
  const added = new Set(add.map((item) => item.name));
  discovered.value = discovered.value.map((item) =>
    added.has(item.config.name) ? { ...item, alreadyImported: true } : item,
  );
  scanNote.value = `已导入 ${add.map((item) => item.name).join("、")}`;
}

function stateLabel(state: string) {
  if (state === "running") return "运行中";
  if (state === "starting") return "启动中";
  if (state === "error") return "错误";
  return "已停止";
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-large-panel="true"
      class="flex h-[min(86vh,820px)] w-[min(980px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
    >
      <DialogHeader class="flex-none border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <DialogTitle class="text-[15px]">MCP 服务</DialogTitle>
        <DialogDescription class="text-[12.5px]">
          配置本地 stdio 或远程 MCP；工具以 <code class="font-[family-name:var(--font-mono)]">mcp.服务.工具</code> 接入 Agent。配置写入 ~/.zen/mcp.json。
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3.5">
          <div class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">添加服务</div>
          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(160px,220px)]">
            <Input v-model="form.name" class="h-8 text-[12px]" placeholder="名称，如 filesystem" />
            <Select v-model="form.transport">
              <SelectTrigger class="h-8 text-[12px]">
                <SelectValue placeholder="传输方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio（本地命令）</SelectItem>
                <SelectItem value="http">HTTP（远程）</SelectItem>
                <SelectItem value="sse">SSE（远程旧版）</SelectItem>
              </SelectContent>
            </Select>
            <Input
              v-if="form.transport === 'stdio'"
              v-model="form.command"
              class="h-8 text-[12px] md:col-span-2"
              placeholder="命令，如 npx -y @modelcontextprotocol/server-filesystem /path"
            />
            <Input
              v-else
              v-model="form.url"
              class="h-8 text-[12px] md:col-span-2"
              placeholder="https://…"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" @click="addServer">
              <Plus class="size-3.5" />添加
            </Button>
            <Button variant="ghost" size="sm" @click="agentStore.refreshMcp()">
              <RefreshCw class="size-3.5" />刷新状态
            </Button>
            <span v-if="formError" class="text-[11.5px] text-[var(--color-danger-fg)]">{{ formError }}</span>
          </div>
        </div>

        <div class="min-w-0">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-[12px] font-medium text-[var(--color-mut)]">
              发现自其它工具
            </span>
            <div class="flex items-center gap-1.5">
              <Button
                v-if="discovered.some((item) => !item.alreadyImported)"
                variant="ghost"
                size="sm"
                @click="importDiscovered(discovered)"
              >
                <Download class="size-3.5" />全部导入
              </Button>
              <Button variant="ghost" size="sm" :disabled="scanBusy" @click="runScan">
                <ScanSearch class="size-3.5" />{{ scanBusy ? "扫描中…" : "扫描" }}
              </Button>
            </div>
          </div>
          <p v-if="scanNote" class="m-0 mb-1.5 text-[11.5px] text-[var(--color-dim)]">{{ scanNote }}</p>
          <div v-if="discovered.length" class="mb-3 flex flex-col gap-1.5">
            <div
              v-for="item in discovered"
              :key="`${item.sourcePath}-${item.config.name}`"
              class="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-3 py-1.5"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
                    {{ item.config.name }}
                  </span>
                  <Badge variant="outline" class="text-[10px]">{{ item.source }}</Badge>
                  <Badge variant="secondary" class="text-[10px]">{{ item.config.transport }}</Badge>
                </div>
                <p
                  class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
                  :title="item.sourcePath"
                >
                  {{ item.config.transport === "stdio"
                    ? [item.config.command, ...(item.config.args || [])].join(" ")
                    : item.config.url }}
                </p>
              </div>
              <Button
                v-if="!item.alreadyImported"
                variant="ghost"
                size="sm"
                class="flex-none"
                :aria-label="`导入 ${item.config.name}`"
                @click="importDiscovered([item])"
              >
                <Download class="size-3.5" />导入
              </Button>
              <Badge v-else variant="secondary" class="flex-none text-[10px]">已导入</Badge>
            </div>
          </div>

          <div class="mb-2 text-[12px] font-medium text-[var(--color-mut)]">
            已配置 {{ mcpStatuses.length }} 个服务
          </div>
          <div v-if="mcpStatuses.length" class="flex flex-col gap-1.5">
            <div
              v-for="item in mcpStatuses"
              :key="item.config.id"
              class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
                    {{ item.config.name }}
                  </span>
                  <Badge variant="secondary" class="text-[10px]">{{ stateLabel(item.state) }}</Badge>
                  <span class="text-[10.5px] text-[var(--color-dim)]">
                    {{ item.tools.length }} 个工具
                  </span>
                </div>
                <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]">
                  {{ item.config.transport === "stdio"
                    ? [item.config.command, ...(item.config.args || [])].join(" ")
                    : item.config.url }}
                </p>
                <p v-if="item.error" class="m-0 mt-0.5 text-[11px] text-[var(--color-danger-fg)]">
                  {{ item.error }}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                class="text-[var(--color-danger-fg)] hover:bg-transparent!"
                aria-label="移除服务"
                @click="removeServer(item.config)"
              >
                <Trash2 class="size-3.5" />
              </Button>
            </div>
          </div>
          <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">尚未配置 MCP 服务。</p>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
