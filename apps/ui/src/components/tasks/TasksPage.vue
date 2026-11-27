<script setup lang="ts">
import { IconLayoutKanban as Kanban, IconLayoutList as List, IconPlus as Plus } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import TaskBoard from "./TaskBoard.vue";
import TaskDetail from "./TaskDetail.vue";
import TaskForm from "./TaskForm.vue";
import TaskList from "./TaskList.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stageOf } from "@/lib/tasks";
import { useTasksStore } from "@/stores/tasks";

import type { Task, TaskStage } from "@zen/shared";

/**
 * 任务整页宿主（对齐 nomi 的 Tasks）：头部 → 阶段筛选/视图 → 列表或看板。
 * 详情抽屉按内容区排布（不遮挡列表滚动）；新建表单是同页对话框（表单不是分类页）。
 */

const store = useTasksStore();
const { tasks, selectedId, error } = storeToRefs(store);
const { t } = useI18n();

type StageFilter = TaskStage | "all";
const STAGE_FILTERS: StageFilter[] = ["all", "todo", "in_progress", "needs_you", "done"];

const stage = ref<StageFilter>("all");
const showArchived = ref(false);
const query = ref("");
const view = ref<"list" | "board">("list");
const formOpen = ref(false);
const actionError = ref("");

onMounted(() => {
  void store.load();
});

onBeforeUnmount(() => {
  store.dispose();
});

function matches(task: Task): boolean {
  const keyword = query.value.trim().toLowerCase();
  return !keyword || `${task.title} ${task.goal}`.toLowerCase().includes(keyword);
}

const activeTasks = computed(() => tasks.value.filter((task) => !task.archivedAt && matches(task)));
const archivedTasks = computed(() => tasks.value.filter((task) => task.archivedAt && matches(task)));

/** 计数只统计未归档（已归档是独立开关，不参与阶段计数） */
const counts = computed<Record<StageFilter, number>>(() => {
  const base: Record<StageFilter, number> = { all: activeTasks.value.length, todo: 0, in_progress: 0, needs_you: 0, done: 0 };
  for (const task of activeTasks.value) {
    base[stageOf(task.status)] += 1;
  }
  return base;
});

const pool = computed(() => (showArchived.value ? archivedTasks.value : activeTasks.value));

const visible = computed(() =>
  stage.value === "all" ? pool.value : pool.value.filter((task) => stageOf(task.status) === stage.value),
);

const emptyText = computed(() => {
  if (query.value.trim()) {
    return t("tasks.emptySearch");
  }
  if (showArchived.value) {
    return t("tasks.emptyArchived");
  }
  return stage.value === "all" ? t("tasks.emptyAll") : t("tasks.emptyStage");
});

async function act(run: () => Promise<string | null>): Promise<void> {
  actionError.value = "";
  const failure = await run();
  if (failure) {
    actionError.value = failure;
  }
}

function open(task: Task): void {
  void store.select(task.id);
}

function runNow(task: Task): void {
  void act(() => store.runNow(task.id));
}

function pause(task: Task): void {
  void act(() => store.pause(task.id));
}

function setArchived(next: boolean): void {
  showArchived.value = next;
  stage.value = "all";
}

function onCreated(task: Task): void {
  formOpen.value = false;
  void store.select(task.id);
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden" data-testid="tasks-page">
    <header class="flex flex-none flex-wrap items-start gap-3 px-6 py-5">
      <div class="min-w-0 flex-1">
        <h2 class="m-0 truncate text-[16px] font-semibold text-[var(--color-txt-strong)]">{{ t("tasks.title") }}</h2>
        <p class="m-0 truncate text-[12px] text-[var(--color-mut)]">{{ t("tasks.subtitle") }}</p>
      </div>
      <div class="flex flex-none items-center gap-1.5">
        <Input
          v-model="query"
          class="h-8 w-[200px] text-[12px]"
          :placeholder="t('tasks.searchPlaceholder')"
          :aria-label="t('tasks.searchPlaceholder')"
          data-testid="tasks-search"
        />
        <Button size="sm" class="flex-none" data-testid="tasks-create" @click="formOpen = true">
          <Plus class="size-3.5" aria-hidden="true" />{{ t("tasks.create") }}
        </Button>
      </div>
    </header>

    <div class="flex flex-none flex-wrap items-center gap-1 px-6 pb-2" role="group" :aria-label="t('tasks.title')">
      <Button
        v-for="item in STAGE_FILTERS"
        :key="item"
        variant="ghost"
        size="xs"
        class="gap-1 text-[11px]"
        :class="stage === item ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
        :aria-pressed="stage === item"
        :data-testid="`tasks-stage-${item}`"
        @click="stage = item"
      >
        {{ t(`tasks.stages.${item}`) }}
        <span class="tabular-nums text-[var(--color-dim)]">{{ counts[item] }}</span>
      </Button>

      <span class="mx-1 h-3.5 w-px bg-[var(--color-line)]" aria-hidden="true" />

      <Button
        variant="ghost"
        size="xs"
        class="text-[11px]"
        :class="showArchived ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
        :aria-pressed="showArchived"
        data-testid="tasks-archived-toggle"
        @click="setArchived(!showArchived)"
      >
        {{ t("tasks.archived") }}
        <span class="tabular-nums text-[var(--color-dim)]">{{ archivedTasks.length }}</span>
      </Button>

      <div class="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :class="view === 'list' ? 'text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
          :title="t('tasks.views.list')"
          :aria-label="t('tasks.views.list')"
          :aria-pressed="view === 'list'"
          data-testid="tasks-view-list"
          @click="view = 'list'"
        >
          <List class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :class="view === 'board' ? 'text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
          :title="t('tasks.views.board')"
          :aria-label="t('tasks.views.board')"
          :aria-pressed="view === 'board'"
          data-testid="tasks-view-board"
          @click="view = 'board'"
        >
          <Kanban class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <p
      v-if="actionError || error"
      class="m-0 flex-none px-6 pb-2 text-[11px] text-[var(--color-err)]"
      data-testid="tasks-error"
    >
      {{ t("tasks.error", { error: actionError || error }) }}
    </p>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
        <TaskBoard
          v-if="view === 'board'"
          :tasks="visible"
          :selected-id="selectedId"
          @open="open"
          @run="runNow"
          @pause="pause"
        />
        <TaskList
          v-else
          :tasks="visible"
          :selected-id="selectedId"
          :empty-text="emptyText"
          @open="open"
          @run="runNow"
          @pause="pause"
        />
      </div>

      <TaskDetail v-if="selectedId" @close="store.clearSelection()" />
    </div>

    <TaskForm v-model:open="formOpen" @created="onCreated" />
  </section>
</template>
