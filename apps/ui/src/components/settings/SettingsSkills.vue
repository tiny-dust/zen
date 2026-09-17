<script setup lang="ts">
import { FolderOpen, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentStore } from "@/stores/agent";

import type { McpServerConfig } from "@zen/shared";

/**
 * 技能与扩展：技能目录扫描（系统目录 + 自定义多路径）与 MCP 服务器配置。
 */
const agentStore = useAgentStore();
const { skills, mcpStatuses, settings } = storeToRefs(agentStore);
const newSkillPath = ref("");
const newServer = ref<{ name: string; command: string }>({ name: "", command: "" });

const SKILL_SYSTEM_DIRS = [
  { path: "~/.zen/skills", label: "Zen 技能" },
  { path: "~/.claude/skills", label: "Claude Code 兼容" },
  { path: "~/.agents/skills", label: "Agent Skills 通用" },
];

const mcpServers = computed<McpServerConfig[]>(
  () => mcpStatuses.value.map((item) => item.config),
);

onMounted(() => {
  void agentStore.refreshSkills();
  void agentStore.refreshMcp();
});

async function addSkillPath() {
  const picked = await agentStore.pickDirectory();
  const path = (picked ?? newSkillPath.value).trim();
  if (!path || settings.value.skillExtraPaths.includes(path)) {
    return;
  }
  await agentStore.updateSettings({
    skillExtraPaths: [...settings.value.skillExtraPaths, path],
  });
  newSkillPath.value = "";
  await agentStore.refreshSkills();
}

async function removeSkillPath(path: string) {
  await agentStore.updateSettings({
    skillExtraPaths: settings.value.skillExtraPaths.filter((item) => item !== path),
  });
  await agentStore.refreshSkills();
}

async function addServer() {
  const name = newServer.value.name.trim();
  const command = newServer.value.command.trim();
  if (!name || !command) {
    return;
  }
  const [cmd, ...args] = command.split(/\s+/);
  await agentStore.saveMcpServers([
    ...mcpServers.value,
    {
      id: `${name}-${Date.now().toString(36)}`,
      name,
      transport: "stdio",
      command: cmd ?? command,
      args,
      enabled: true,
    },
  ]);
  newServer.value = { name: "", command: "" };
  await agentStore.refreshMcp();
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

function stateBadge(state: string): "secondary" | "outline" | "default" {
  if (state === "running") {
    return "default";
  }
  if (state === "error") {
    return "secondary";
  }
  return "outline";
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 技能 -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">技能</h3>
        <Button variant="ghost" size="sm" @click="agentStore.refreshSkills()">
          <RefreshCw :size="13" data-icon="inline-start" />重新扫描
        </Button>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        每个技能是一个含 SKILL.md 的目录，自动扫描以下系统目录；Agent 会在合适时机按需加载。
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Badge v-for="dir in SKILL_SYSTEM_DIRS" :key="dir.path" variant="outline">
          <FolderOpen :size="11" data-icon="inline-start" />{{ dir.path }}
        </Badge>
      </div>

      <div v-if="skills.length" class="flex flex-col gap-1.5">
        <div
          v-for="skill in skills"
          :key="skill.id"
          class="rounded-xl border border-[var(--color-line)] px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ skill.name }}
            </span>
            <Badge variant="secondary" class="text-[10px]">
              {{ skill.source === "user" ? "Zen" : "系统目录" }}
            </Badge>
          </div>
          <p v-if="skill.description" class="m-0 mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-mut)]">
            {{ skill.description }}
          </p>
          <p class="m-0 mt-0.5 truncate text-[10.5px] text-[var(--color-dim)]">{{ skill.dir }}</p>
        </div>
      </div>
      <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">
        未发现技能。把含 SKILL.md 的目录放进上面的系统目录即可。
      </p>

      <div class="flex flex-col gap-1.5">
        <div class="text-[12px] text-[var(--color-mut)]">自定义目录（可多选）</div>
        <div
          v-for="path in settings.skillExtraPaths"
          :key="path"
          class="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5"
        >
          <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">{{ path }}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="移除目录"
            @click="removeSkillPath(path)"
          >
            <Trash2 :size="13" />
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="addSkillPath">
            <Plus :size="13" data-icon="inline-start" />添加目录
          </Button>
          <Input
            v-model="newSkillPath"
            class="h-8 flex-1 bg-[var(--color-np-btn-bg)] text-[12px]"
            placeholder="或手动输入路径，如 ~/projects/my-skills"
            @keydown.enter="addSkillPath"
          />
        </div>
      </div>
    </section>

    <!-- MCP -->
    <section class="flex flex-col gap-2.5">
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">MCP 服务器</h3>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        stdio 服务器按需启动，工具会以 <code
          class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
        >mcp.服务器.工具</code> 的形式接入 Agent；配置持久化在 ~/.zen/mcp.json。
      </p>

      <div v-if="mcpStatuses.length" class="flex flex-col gap-1.5">
        <div
          v-for="item in mcpStatuses"
          :key="item.config.id"
          class="rounded-xl border border-[var(--color-line)] px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ item.config.name }}
            </span>
            <Badge :variant="stateBadge(item.state)" class="text-[10px]">
              {{ item.state === "running" ? "运行中" : item.state === "error" ? "异常" : "已停止" }}
            </Badge>
            <span class="min-w-0 flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="item.config.enabled ? '禁用' : '启用'"
              @click="toggleServer(item.config)"
            >
              {{ item.config.enabled ? "禁用" : "启用" }}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="删除" @click="removeServer(item.config)">
              <Trash2 :size="13" />
            </Button>
          </div>
          <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]">
            {{ item.config.command }} {{ (item.config.args ?? []).join(" ") }}
          </p>
          <p v-if="item.tools.length" class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">
            {{ item.tools.length }} 个工具：{{ item.tools.map((tool) => tool.name).join("、") }}
          </p>
          <p v-if="item.error" class="m-0 mt-0.5 text-[11px] text-[var(--color-err)]">
            {{ item.error }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Input
          v-model="newServer.name"
          class="h-8 w-32 bg-[var(--color-np-btn-bg)] text-[12px]"
          placeholder="名称"
        />
        <Input
          v-model="newServer.command"
          class="h-8 flex-1 bg-[var(--color-np-btn-bg)] text-[12px]"
          placeholder="启动命令，如 npx -y @modelcontextprotocol/server-filesystem ~/docs"
          @keydown.enter="addServer"
        />
        <Button variant="outline" size="sm" @click="addServer">
          <Plus :size="13" data-icon="inline-start" />添加
        </Button>
      </div>
    </section>
  </div>
</template>
