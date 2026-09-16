<script setup lang="ts">
import { ChevronDown, Circle, CircleCheck, Gauge, GitBranch, Laptop } from "@lucide/vue";
import { classes } from "rattail";
import { computed, ref } from "vue";

import { useChatStore } from "@/stores/chat";

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const chatStore = useChatStore();

const tasks = computed(() => [
  { id: "t1", label: "初始化 monorepo 骨架", done: true },
  { id: "t2", label: "接入流式 Agent 回复", done: chatStore.isRunning || chatStore.hasMessages },
  { id: "t3", label: "接入真实模型工具链", done: false },
]);

const artifacts = computed(() => [
  { id: "a1", name: "README.md", kind: "doc" },
  { id: "a2", name: "styles.css", kind: "code" },
]);

const refs = computed(() => [
  { id: "r1", name: "docs/architecture/ARCHITECTURE.md" },
  { id: "r2", name: "docs/architecture/NEXT_STEPS.md" },
]);

const changedFiles = computed(() => [
  "apps/ui/src/App.vue",
  "apps/ui/src/styles.css",
  "apps/desktop/src/main/index.ts",
]);

const branch = computed(() => chatStore.branch);
const repo = computed(() => chatStore.repo);
const contextUsage = computed(() => chatStore.contextUsage);

const hasEnv = computed(() => Boolean(repo.value || branch.value || contextUsage.value != null));
const doneCount = computed(() => tasks.value.filter((item) => item.done).length);

const openSections = ref(new Set(["env", "tasks", "artifacts", "refs", "files"]));

function toggleSection(id: string) {
  const next = new Set(openSections.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  openSections.value = next;
}

const cardCls = classes(
  "flex min-h-0 flex-1 flex-col",
  // embedded（弹窗内）不带卡片壳，由宿主容器负责
  "rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-raise)] p-3",
);
const sectionCls = "flex flex-col";
const headCls =
  "flex min-h-8 w-full items-center gap-1.5 rounded-[var(--radius-sm)] text-left text-[13px] font-semibold text-[var(--color-txt-strong)] hover:text-[var(--color-txt)]";
const badgeCls =
  "ml-auto inline-flex h-5 items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10.5px] font-normal text-[var(--color-mut)]";
const envRowCls = "flex h-8 items-center gap-2 text-[12.5px] text-[var(--color-txt)]";
const envIconCls = "size-3.5 flex-none text-[var(--color-mut)]";
const listCls = "m-0 flex list-none flex-col gap-1 p-0 pb-1";
</script>

<template>
  <aside
    :class="
      embedded
        ? 'flex min-w-0 flex-col bg-transparent'
        : 'flex h-full min-w-0 flex-col overflow-hidden bg-transparent p-2'
    "
    aria-label="会话信息"
  >
    <div :class="embedded ? 'flex flex-col gap-5' : cardCls">
      <section v-if="hasEnv" :class="sectionCls">
        <button type="button" :class="headCls" @click="toggleSection('env')">
          环境信息
          <ChevronDown
            class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="openSections.has('env') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
        </button>
        <div v-if="openSections.has('env')" class="mt-1 flex flex-col">
          <div v-if="repo" :class="envRowCls">
            <Laptop :class="envIconCls" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ repo }}</span>
          </div>
          <div v-if="branch" :class="envRowCls">
            <GitBranch :class="envIconCls" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[12px]">
              {{ branch }}
            </span>
          </div>
          <div v-if="contextUsage != null" :class="envRowCls">
            <Gauge :class="envIconCls" aria-hidden="true" />
            <span class="min-w-0 flex-1">上下文</span>
            <span class="flex-none font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--color-mut)]">
              {{ contextUsage }}%
            </span>
          </div>
        </div>
      </section>

      <section :class="sectionCls">
        <button type="button" :class="headCls" @click="toggleSection('tasks')">
          任务清单
          <ChevronDown
            class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="openSections.has('tasks') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <span :class="badgeCls">{{ doneCount }}/{{ tasks.length }}</span>
        </button>
        <ul v-if="openSections.has('tasks')" :class="listCls">
          <li
            v-for="item in tasks"
            :key="item.id"
            class="flex items-center gap-2 text-[12px]"
            :class="item.done ? 'text-[var(--color-mut)] line-through' : 'text-[var(--color-txt)]'"
          >
            <CircleCheck
              v-if="item.done"
              class="size-3.5 flex-none text-[var(--color-add)]"
              aria-hidden="true"
            />
            <Circle v-else class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
            <span class="min-w-0 flex-1">{{ item.label }}</span>
          </li>
        </ul>
      </section>

      <section :class="sectionCls">
        <button type="button" :class="headCls" @click="toggleSection('artifacts')">
          产物
          <ChevronDown
            class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="openSections.has('artifacts') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <span :class="badgeCls">{{ artifacts.length }}</span>
        </button>
        <ul v-if="openSections.has('artifacts')" :class="listCls">
          <li
            v-for="item in artifacts"
            :key="item.id"
            class="flex items-center gap-2 text-[12px] text-[var(--color-txt)]"
          >
            <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
            <span
              class="flex-none rounded-full bg-[var(--color-chip-bg)] px-1.5 py-px text-[10px] uppercase text-[var(--color-chip-text)]"
            >
              {{ item.kind }}
            </span>
          </li>
        </ul>
      </section>

      <section :class="sectionCls">
        <button type="button" :class="headCls" @click="toggleSection('refs')">
          参考
          <ChevronDown
            class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="openSections.has('refs') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <span :class="badgeCls">{{ refs.length }}</span>
        </button>
        <ul v-if="openSections.has('refs')" :class="listCls">
          <li
            v-for="item in refs"
            :key="item.id"
            class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
          >
            {{ item.name }}
          </li>
        </ul>
      </section>

      <section :class="sectionCls">
        <button type="button" :class="headCls" @click="toggleSection('files')">
          项目文件
          <ChevronDown
            class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
            :class="openSections.has('files') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <span :class="badgeCls">{{ changedFiles.length }}</span>
        </button>
        <ul v-if="openSections.has('files')" :class="listCls">
          <li
            v-for="file in changedFiles"
            :key="file"
            class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
          >
            {{ file }}
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>
