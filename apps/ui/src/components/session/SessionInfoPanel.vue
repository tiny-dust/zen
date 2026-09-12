<script setup lang="ts">
import { computed } from "vue";

import { useChatStore } from "@/stores/chat";

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

const skills = computed(() => ["coder", "rattail"]);

const changedFiles = computed(() => [
  "apps/ui/src/App.vue",
  "apps/ui/src/styles.css",
  "apps/desktop/src/main/index.ts",
]);

const branch = computed(() => "main");
</script>

<template>
  <aside class="session-panel" aria-label="会话信息">
    <div class="panel-title">会话信息</div>

    <section class="block">
      <h3>任务清单</h3>
      <ul>
        <li v-for="item in tasks" :key="item.id" :class="{ done: item.done }">
          <span class="check" aria-hidden="true" />
          {{ item.label }}
        </li>
      </ul>
    </section>

    <section class="block">
      <h3>产物</h3>
      <ul>
        <li v-for="item in artifacts" :key="item.id">
          <span class="chip">{{ item.kind }}</span>
          {{ item.name }}
        </li>
      </ul>
    </section>

    <section class="block">
      <h3>参考文件</h3>
      <ul>
        <li v-for="item in refs" :key="item.id" class="path">{{ item.name }}</li>
      </ul>
    </section>

    <section class="block">
      <h3>调用技能</h3>
      <div class="tags">
        <span v-for="skill in skills" :key="skill" class="tag">{{ skill }}</span>
      </div>
    </section>

    <section class="block">
      <h3>变更文件</h3>
      <ul>
        <li v-for="file in changedFiles" :key="file" class="path">{{ file }}</li>
      </ul>
    </section>

    <section class="block">
      <h3>分支</h3>
      <code class="branch">{{ branch }}</code>
    </section>
  </aside>
</template>

<style scoped>
.session-panel {
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding: 12px;
  background: var(--color-side);
  border-left: 1px solid var(--color-line);
}

.panel-title {
  font-size: 12px;
  color: var(--color-mut);
  margin-bottom: 10px;
}

.block {
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-composer-surface);
}

.block h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.block ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.block li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-txt);
}

.block li.done {
  color: var(--color-mut);
  text-decoration: line-through;
}

.check {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid var(--color-btn-border);
  flex: none;
}

li.done .check {
  background: var(--color-add);
  border-color: var(--color-add);
}

.path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-mut);
  word-break: break-all;
}

.chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-chip-bg);
  color: var(--color-chip-text);
  text-transform: uppercase;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-chip-bg);
  color: var(--color-txt);
}

.branch {
  display: inline-block;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
}
</style>
