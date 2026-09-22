<script setup lang="ts">
import { Plus, RefreshCw, Trash2 } from "@lucide/vue";
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

import type { McpServerConfig, McpTransport } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const agentStore = useAgentStore();
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

      <div class="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3.5">
          <div class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">添加服务</div>
          <div class="grid gap-2">
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
              class="h-8 text-[12px]"
              placeholder="命令，如 npx -y @modelcontextprotocol/server-filesystem /path"
            />
            <Input
              v-else
              v-model="form.url"
              class="h-8 text-[12px]"
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
