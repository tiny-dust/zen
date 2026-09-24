<script setup lang="ts">
import { ChevronRight, Circle, CircleCheck, ListChecks } from "@lucide/vue";
import { computed, h, ref, watch } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useSessionInfoStore } from "@/stores/session-info";
import { cn } from "@/lib/utils";

const sessionInfo = useSessionInfoStore();
const open = ref(true);
const tabsEl = ref<HTMLElement | null>(null);

const versions = computed(() => sessionInfo.versions);
const activeId = computed(() => sessionInfo.activeVersionId);
const tasks = computed(() => sessionInfo.activeTasks);
const doneCount = computed(() => sessionInfo.doneCount);

/** 任务条目勾选图标（主任务与子 Agent 组内条目共用） */
const TaskCheckIcon = (props: { done?: boolean }) =>
  props.done
    ? h(CircleCheck, {
        class: "mt-1 size-3.5 flex-none text-[var(--color-add)]",
        "aria-hidden": "true",
      })
    : h(Circle, {
        class: "mt-1 size-3.5 flex-none text-[var(--color-dim)]",
        "aria-hidden": "true",
      });
TaskCheckIcon.props = { done: { type: Boolean, default: false } };

/** 子 Agent 分组：无 agentName 的归主任务（置顶不折叠），其余按 agentName 分组可折叠 */
interface AgentGroup {
  name: string;
  items: typeof tasks.value;
  doneCount: number;
}

const mainTasks = computed(() => tasks.value.filter((task) => !task.agentName));
const agentGroups = computed<AgentGroup[]>(() => {
  const groups = new Map<string, typeof tasks.value>();
  for (const task of tasks.value) {
    if (!task.agentName) {
      continue;
    }
    const list = groups.get(task.agentName);
    if (list) {
      list.push(task);
    } else {
      groups.set(task.agentName, [task]);
    }
  }
  return [...groups].map(([name, items]) => ({
    name,
    items,
    doneCount: items.filter((item) => item.done).length,
  }));
});
/** 各组展开状态；不在 set 里即展开，组消失时清理残留 key */
const collapsed = ref(new Set<string>());
watch(agentGroups, (groups) => {
  for (const name of [...collapsed.value]) {
    if (!groups.some((group) => group.name === name)) {
      collapsed.value.delete(name);
    }
  }
});

function toggleGroup(name: string) {
  if (collapsed.value.has(name)) {
    collapsed.value.delete(name);
  } else {
    collapsed.value.add(name);
  }
}

function select(id: string) {
  sessionInfo.activeVersionId = id;
}

watch(
  () => versions.value.length,
  () => {
    void requestAnimationFrame(() => {
      tabsEl.value?.scrollTo({ left: tabsEl.value.scrollWidth });
    });
  },
);
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="ListChecks"
      title="任务清单"
      :open="open"
      :count="tasks.length ? `${doneCount}/${tasks.length}` : undefined"
      @toggle="open = !open"
    />

    <div v-if="open" class="mt-1 flex flex-col gap-2 pl-[5px]">
      <div
        v-if="versions.length > 1"
        ref="tabsEl"
        class="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]"
        role="tablist"
        aria-label="任务清单版本"
      >
        <Button
          v-for="item in versions"
          :key="item.id"
          variant="ghost"
          size="xs"
          role="tab"
          :aria-selected="item.id === activeId"
          :class="
            cn(
              'h-6 flex-none rounded-full px-2 text-[11px] font-normal',
              item.id === activeId
                ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-active)] hover:text-[var(--color-txt-strong)] dark:hover:bg-[var(--color-menu-active)]'
                : 'text-[var(--color-mut)] hover:bg-transparent hover:text-[var(--color-txt)] dark:hover:bg-transparent',
            )
          "
          @click="select(item.id)"
        >
          v{{ item.version }}
        </Button>
      </div>

      <!-- 主任务（无 agentName）：置顶平铺，不参与分组折叠 -->
      <ul v-if="mainTasks.length" class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="task in mainTasks"
          :key="task.id"
          class="flex items-start gap-2 text-[13px] leading-relaxed"
          :class="task.done ? 'text-[var(--color-mut)]' : 'text-[var(--color-txt)]'"
        >
          <TaskCheckIcon :done="task.done" />
          <span class="min-w-0 flex-1 break-words">{{ task.label }}</span>
        </li>
      </ul>

      <!-- 子 Agent 分组：组头可点击折叠，展开后条目复用主任务行样式（缩进一档） -->
      <div v-for="group in agentGroups" :key="group.name" class="flex flex-col gap-1.5">
        <button
          type="button"
          class="flex h-6 w-fit cursor-pointer items-center gap-1 rounded px-0.5 text-[12px] leading-none text-[var(--color-mut)] hover:text-[var(--color-txt)]"
          :aria-expanded="!collapsed.has(group.name)"
          @click="toggleGroup(group.name)"
        >
          <ChevronRight
            class="size-3 flex-none transition-transform"
            :class="collapsed.has(group.name) ? '' : 'rotate-90'"
            aria-hidden="true"
          />
          <span class="max-w-[180px] truncate font-medium">{{ group.name }}</span>
          <span class="text-[10px] text-[var(--color-dim)]">{{ group.doneCount }}/{{ group.items.length }}</span>
        </button>
        <ul v-if="!collapsed.has(group.name)" class="m-0 flex list-none flex-col gap-2 pl-[13px]">
          <li
            v-for="task in group.items"
            :key="task.id"
            class="flex items-start gap-2 text-[13px] leading-relaxed"
            :class="task.done ? 'text-[var(--color-mut)]' : 'text-[var(--color-txt)]'"
          >
            <TaskCheckIcon :done="task.done" />
            <span class="min-w-0 flex-1 break-words">{{ task.label }}</span>
          </li>
        </ul>
      </div>

      <!-- 空态文字与节内行文字同列（容器 5px + 22px = 27px） -->
      <p v-if="!tasks.length" class="m-0 pl-[22px] text-[12px] text-[var(--color-dim)]">暂无任务</p>
    </div>
  </section>
</template>
