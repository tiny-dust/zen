<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Trash2,
  X,
} from "@lucide/vue";
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
// 正在编辑的服务 id；null 表示表单处于「添加」模式（与 SettingsMcp 一致）
const editingId = ref<string | null>(null);
const formError = ref("");

const mcpServers = computed<McpServerConfig[]>(() =>
  mcpStatuses.value.map((item) => item.config),
);

watch(open, (value) => {
  if (value) {
    void agentStore.refreshMcp().then(() => {
      // 默认展开运行中的服务，便于直接查看工具清单
      expandedIds.value = new Set(
        mcpStatuses.value.filter((item) => item.state === "running").map((item) => item.config.id),
      );
    });
  }
});

/** 各服务工具清单的展开状态 */
const expandedIds = ref<Set<string>>(new Set());

function toggleTools(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedIds.value = next;
}

/** inputSchema 参数摘要：参数名/类型/是否必填，不渲染整段 JSON */
function schemaSummary(schema: Record<string, unknown>): string {
  const properties = schema["properties"];
  if (!properties || typeof properties !== "object") {
    return "";
  }
  const props = properties as Record<string, unknown>;
  const requiredList = Array.isArray(schema["required"]) ? schema["required"] : [];
  const required = new Set(
    requiredList.filter((item): item is string => typeof item === "string"),
  );
  const entries = Object.entries(props);
  const parts = entries.slice(0, 6).map(([name, def]) => {
    const type =
      def && typeof def === "object" && typeof (def as { type?: unknown }).type === "string"
        ? (def as { type: string }).type
        : "any";
    return `${name}: ${type}${required.has(name) ? "" : "?"}`;
  });
  return parts.join("，") + (entries.length > 6 ? "…" : "");
}

/** 把表单解析成 McpServerConfig；添加与编辑共用，id 由调用方决定 */
function buildConfigFromForm(): { config: McpServerConfig } | { error: string } {
  const name = form.value.name.trim();
  if (!name) {
    return { error: "请填写服务名称" };
  }
  const base = {
    id: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`,
    name,
    transport: form.value.transport,
    enabled: true,
  };
  if (form.value.transport === "stdio") {
    const commandLine = form.value.command.trim();
    if (!commandLine) {
      return { error: "请填写启动命令" };
    }
    const [cmd, ...args] = commandLine.split(/\s+/);
    let env: Record<string, string> | undefined;
    const envRaw = form.value.env.trim();
    if (envRaw) {
      try {
        env = JSON.parse(envRaw) as Record<string, string>;
      } catch {
        return { error: "环境变量不是合法 JSON，例如 {\"API_KEY\":\"xxx\"}" };
      }
    }
    return { config: { ...base, command: cmd ?? commandLine, args, env } };
  }
  const url = form.value.url.trim();
  if (!/^https?:\/\//.test(url)) {
    return { error: "请填写 http(s):// 开头的服务地址" };
  }
  let headers: Record<string, string> | undefined;
  const raw = form.value.headers.trim();
  if (raw) {
    try {
      headers = JSON.parse(raw) as Record<string, string>;
    } catch {
      return { error: "请求头不是合法 JSON，例如 {\"Authorization\":\"Bearer xxx\"}" };
    }
  }
  return { config: { ...base, url, headers } };
}

function resetForm() {
  form.value = { name: "", transport: "stdio", command: "", env: "", url: "", headers: "" };
  formError.value = "";
}

async function addServer() {
  const parsed = buildConfigFromForm();
  if ("error" in parsed) {
    formError.value = parsed.error;
    return;
  }
  await agentStore.saveMcpServers([...mcpServers.value, parsed.config]);
  resetForm();
}

/** 编辑既有服务（含扫描导入的）：表单预填，保存时保留 id / enabled，其余字段以表单为准 */
function startEdit(config: McpServerConfig) {
  editingId.value = config.id;
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
  await agentStore.saveMcpServers(
    mcpServers.value.map((item) =>
      item.id === target.id
        ? { ...parsed.config, id: target.id, enabled: target.enabled }
        : item,
    ),
  );
  cancelEdit();
}

async function submitForm() {
  if (editingId.value) {
    await saveEdit();
  } else {
    await addServer();
  }
}

async function removeServer(config: McpServerConfig) {
  if (editingId.value === config.id) {
    cancelEdit();
  }
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
        <DialogDescription class="text-[12px]">
          配置本地 stdio 或远程 MCP；工具以 <code class="font-[family-name:var(--font-mono)]">mcp.服务.工具</code> 接入 Agent。配置写入 ~/.zen/mcp.json。
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3.5">
          <div class="text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ editingId ? "编辑服务" : "添加服务" }}
          </div>
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
            <template v-if="form.transport === 'stdio'">
              <Input
                v-model="form.command"
                class="h-8 text-[12px] md:col-span-2"
                placeholder="命令，如 npx -y @modelcontextprotocol/server-filesystem /path"
                @keydown.enter="submitForm"
              />
              <Input
                v-model="form.env"
                class="h-8 text-[12px] md:col-span-2"
                placeholder='环境变量（JSON，可选），如 {"API_KEY":"xxx"}'
                @keydown.enter="submitForm"
              />
            </template>
            <template v-else>
              <Input
                v-model="form.url"
                class="h-8 text-[12px] md:col-span-2"
                placeholder="https://…"
                @keydown.enter="submitForm"
              />
              <Input
                v-model="form.headers"
                class="h-8 text-[12px] md:col-span-2"
                placeholder='附加请求头（JSON，可选），如 {"Authorization":"Bearer xxx"}'
                @keydown.enter="submitForm"
              />
            </template>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" @click="submitForm">
              <Plus v-if="!editingId" class="size-3.5" />{{ editingId ? "保存" : "添加" }}
            </Button>
            <Button v-if="editingId" variant="ghost" size="sm" @click="cancelEdit">
              <X class="size-3.5" />取消
            </Button>
            <Button variant="ghost" size="sm" @click="agentStore.refreshMcp()">
              <RefreshCw class="size-3.5" />刷新状态
            </Button>
            <span v-if="formError" class="text-[11px] text-[var(--color-danger-fg)]">{{ formError }}</span>
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
          <p v-if="scanNote" class="m-0 mb-1.5 text-[11px] text-[var(--color-dim)]">{{ scanNote }}</p>
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
                  class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
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
                  <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
                    {{ item.config.name }}
                  </span>
                  <Badge variant="secondary" class="text-[10px]">{{ stateLabel(item.state) }}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-5 gap-0.5 px-1 text-[10px] text-[var(--color-dim)] hover:bg-transparent!"
                    :aria-expanded="expandedIds.has(item.config.id)"
                    @click="toggleTools(item.config.id)"
                  >
                    <ChevronDown v-if="expandedIds.has(item.config.id)" class="size-3" />
                    <ChevronRight v-else class="size-3" />
                    {{ item.tools.length }} 个工具
                  </Button>
                </div>
                <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]">
                  {{ item.config.transport === "stdio"
                    ? [item.config.command, ...(item.config.args || [])].join(" ")
                    : item.config.url }}
                </p>
                <p v-if="item.error" class="m-0 mt-0.5 text-[11px] text-[var(--color-danger-fg)]">
                  {{ item.error }}
                </p>
                <div
                  v-if="expandedIds.has(item.config.id)"
                  class="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-sunken)] px-2.5 py-1.5"
                >
                  <p
                    v-if="item.state === 'running' && !item.tools.length"
                    class="m-0 text-[11px] text-[var(--color-dim)]"
                  >
                    无工具
                  </p>
                  <div v-for="tool in item.tools" :key="tool.name" class="flex flex-col gap-0.5">
                    <span class="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]">
                      {{ tool.name }}
                    </span>
                    <p class="m-0 text-[11px] text-[var(--color-mut)]">
                      {{ tool.description || "无描述" }}
                    </p>
                    <p
                      v-if="schemaSummary(tool.inputSchema)"
                      class="m-0 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]"
                      :title="schemaSummary(tool.inputSchema)"
                    >
                      参数：{{ schemaSummary(tool.inputSchema) }}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="`编辑 ${item.config.name}`"
                @click="startEdit(item.config)"
              >
                <Pencil class="size-3.5" />
              </Button>
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
