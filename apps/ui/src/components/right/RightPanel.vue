<script setup lang="ts">
import { classes } from "rattail";
import { computed, ref } from "vue";

type PluginId = "code" | "git" | "browser";

const plugins: Array<{ id: PluginId; label: string }> = [
  { id: "code", label: "代码" },
  { id: "git", label: "Git" },
  { id: "browser", label: "浏览器" },
];

const active = ref<PluginId>("code");

const activeLabel = computed(() => plugins.find((item) => item.id === active.value)?.label ?? "");

const tabClass = (id: PluginId) => classes("tab", [active.value === id, "is-active"]);
</script>

<template>
  <aside class="right-panel" aria-label="插件区">
    <div class="tabs" role="tablist" aria-label="插件">
      <button
        v-for="plugin in plugins"
        :key="plugin.id"
        type="button"
        :class="tabClass(plugin.id)"
        role="tab"
        :aria-selected="active === plugin.id"
        @click="active = plugin.id"
      >
        {{ plugin.label }}
      </button>
    </div>

    <div class="body">
      <template v-if="active === 'code'">
        <div class="empty">
          <p class="empty-title">代码文件</p>
          <p class="empty-hint">打开项目文件后将在此预览（P1：CodeMirror）。</p>
          <pre class="mock-code">apps/ui/src/App.vue
apps/desktop/src/main/index.ts</pre>
        </div>
      </template>

      <template v-else-if="active === 'git'">
        <div class="empty">
          <p class="empty-title">Git 信息</p>
          <p class="empty-hint">分支、diff 与提交记录（P1：simple-git）。</p>
          <code class="mock-branch">main · clean</code>
        </div>
      </template>

      <template v-else>
        <div class="empty">
          <p class="empty-title">浏览器</p>
          <p class="empty-hint">WebContentsView 页面抽取与理解（P2）。</p>
        </div>
      </template>
    </div>

    <footer class="footer">{{ activeLabel }} 面板</footer>
  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--color-side);
  border-left: 1px solid var(--color-line);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 10px;
  border-bottom: 1px solid var(--color-line);
}

.tab {
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-mut);
  border: 1px solid transparent;
}

.tab:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt);
}

.tab.is-active {
  background: var(--color-menu-active);
  color: var(--color-txt-strong);
  border-color: var(--color-line);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}

.empty {
  color: var(--color-mut);
}

.empty-title {
  margin: 0 0 6px;
  color: var(--color-txt-strong);
  font-size: 13px;
  font-weight: 600;
}

.empty-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
}

.mock-code,
.mock-branch {
  display: block;
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-code-bg);
  color: var(--color-code-fg);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
}

.footer {
  padding: 8px 12px;
  border-top: 1px solid var(--color-line);
  font-size: 11px;
  color: var(--color-dim);
}
</style>
