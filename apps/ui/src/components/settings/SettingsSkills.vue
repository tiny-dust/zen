<script setup lang="ts">
import { FolderOpen, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillSourceLabel } from "@/lib/skill-source";
import { useAgentStore } from "@/stores/agent";

/**
 * 技能：技能目录扫描（系统目录 + 自定义多路径）。MCP 服务在独立面板配置。
 */
const agentStore = useAgentStore();
const { skills, settings } = storeToRefs(agentStore);
const newSkillPath = ref("");

const SKILL_SYSTEM_DIRS = [
  { path: "~/.zen/skills", label: "Zen 技能" },
  { path: "~/.claude/skills", label: "Claude Code 兼容" },
  { path: "~/.agents/skills", label: "Agent Skills 通用" },
];

onMounted(() => {
  void agentStore.refreshSkills();
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
</script>

<template>
  <div class="flex flex-col gap-5">
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
              {{ skillSourceLabel(skill) }}
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
  </div>
</template>
