<script setup lang="ts">
import { Bell, Cable, ChevronDown, CircleDot, Folder, PanelLeft, Search, Sparkles } from "@lucide/vue";

import UserBlock from "@/components/sidebar/UserBlock.vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";

const layoutStore = useLayoutStore();

const actions = [
  { id: "new-task", label: "新建任务", icon: CircleDot },
  { id: "skills", label: "技能", icon: Sparkles },
  { id: "mcp", label: "MCP", icon: Cable },
];

const projects = [
  { id: "zen", label: "zen", active: true },
  { id: "demo", label: "demo-workspace", active: false },
];

const emit = defineEmits<{
  action: [id: string];
}>();

const navCls =
  "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]";
const sectionCls = "flex flex-col gap-0.5 px-2";
const headCls =
  "flex items-center gap-1 px-3.5 pt-4 pb-1.5 text-[11.5px] text-[var(--color-dim)]";
const headerBtnCls =
  "text-[var(--color-topbar-icon)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]";

function iconCls(active: boolean) {
  return cn("size-4 flex-none", active ? "text-[var(--color-mut)]" : "text-[var(--color-dim)]");
}

function projectCls(active: boolean) {
  return cn(
    navCls,
    active && "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)]",
  );
}
</script>

<template>
  <aside
    class="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--color-side)]"
    aria-label="侧边栏"
  >
    <!-- 头行：窗口 chrome，与交通灯同行 -->
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center gap-0.5 px-1.5 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
      <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="收起侧栏"
        title="收起侧栏"
        @click="layoutStore.toggleLeft()"
      >
        <PanelLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="搜索"
        title="搜索"
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="headerBtnCls"
        aria-label="通知"
        title="通知"
      >
        <Bell />
      </Button>
    </header>

    <div class="flex items-center gap-2 px-4 pb-1 pt-2.5">
      <span class="text-[15px] font-bold tracking-tight text-[var(--color-txt-strong)]">Zen</span>
      <span
        class="rounded-full bg-[var(--color-side-sel)] px-1.5 py-px text-[10px] leading-4 text-[var(--color-mut)]"
      >
        Beta
      </span>
    </div>

    <div :class="sectionCls" class="pt-1.5">
      <button
        v-for="item in actions"
        :key="item.id"
        type="button"
        :class="navCls"
        @click="emit('action', item.id)"
      >
        <component :is="item.icon" :class="iconCls(false)" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div :class="headCls">
      项目
      <ChevronDown class="size-3" aria-hidden="true" />
    </div>
    <div :class="sectionCls">
      <button
        v-for="item in projects"
        :key="item.id"
        type="button"
        :class="projectCls(item.active)"
      >
        <Folder :class="iconCls(item.active)" aria-hidden="true" />
        <span class="truncate">{{ item.label }}</span>
      </button>
    </div>

    <div class="mt-auto p-2">
      <UserBlock />
    </div>
  </aside>
</template>
