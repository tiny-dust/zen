<script setup lang="ts">
import BaseButton from "@/components/base/BaseButton.vue";
import IconButton from "@/components/base/IconButton.vue";

const appVersion = "0.1.0";

const actions = [
  { id: "new-task", label: "新建任务" },
  { id: "skills", label: "技能" },
  { id: "mcp", label: "MCP" },
];

const common = [
  { id: "inbox", label: "收件箱" },
  { id: "automations", label: "自动化" },
  { id: "artifacts", label: "产物" },
];

const projects = [
  { id: "zen", label: "zen" },
  { id: "demo", label: "demo-workspace" },
];

const emit = defineEmits<{
  action: [id: string];
}>();
</script>

<template>
  <aside class="sidebar" aria-label="侧边栏">
    <div class="top-row">
      <div class="brand">
        <div class="logo" aria-hidden="true">Z</div>
        <div class="brand-text">
          <div class="brand-name">Zen</div>
          <div class="brand-version">v{{ appVersion }}</div>
        </div>
      </div>
      <div class="top-actions">
        <IconButton label="搜索">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
        </IconButton>
        <IconButton label="通知">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 1.5 5H4.5S6 13 6 9Z" />
            <path d="M10 19a2 2 0 0 0 4 0" />
          </svg>
        </IconButton>
      </div>
    </div>

    <div class="section">
      <button
        v-for="item in actions"
        :key="item.id"
        type="button"
        class="nav-item nav-item--action"
        @click="emit('action', item.id)"
      >
        <span class="nav-dot" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="section">
      <div class="section-title">公共</div>
      <button
        v-for="item in common"
        :key="item.id"
        type="button"
        class="nav-item"
        @click="emit('action', item.id)"
      >
        <span class="nav-icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="section section--grow">
      <div class="section-title">项目</div>
      <button
        v-for="item in projects"
        :key="item.id"
        type="button"
        class="nav-item"
        @click="emit('action', item.id)"
      >
        <span class="nav-icon nav-icon--folder" aria-hidden="true" />
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </div>

    <footer class="user">
      <div class="avatar">R</div>
      <div class="user-meta">
        <div class="user-name">Reynold</div>
        <div class="user-sub">本地工作区</div>
      </div>
      <BaseButton variant="ghost" class="user-settings">设置</BaseButton>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-side);
  border-right: 1px solid var(--color-line);
  color: var(--color-txt);
}

.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 12px 10px;
  padding-top: 44px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--color-send);
  color: var(--color-send-fg);
  font-weight: 700;
  font-size: 13px;
  flex: none;
}

.brand-text {
  min-width: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-txt-strong);
  line-height: 1.2;
}

.brand-version {
  font-size: 11px;
  color: var(--color-mut);
  font-family: var(--font-mono);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.section {
  padding: 4px 10px 10px;
}

.section--grow {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.section-title {
  padding: 8px 8px 6px;
  font-size: 11px;
  color: var(--color-dim);
  letter-spacing: 0.02em;
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--color-txt);
  text-align: left;
  transition: background var(--motion-fast) var(--ease-enter);
}

.nav-item:hover {
  background: var(--color-side-hover);
}

.nav-item--action {
  color: var(--color-txt-strong);
  font-weight: 500;
}

.nav-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-accent);
}

.nav-icon {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--color-side-sel);
  border: 1px solid var(--color-line);
  flex: none;
}

.nav-icon--folder {
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-accent-2) 35%, var(--color-side-sel));
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 14px;
  border-top: 1px solid var(--color-line-soft);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
  font-size: 12px;
  font-weight: 600;
  flex: none;
}

.user-meta {
  min-width: 0;
  flex: 1;
}

.user-name {
  font-size: 13px;
  color: var(--color-txt-strong);
  line-height: 1.2;
}

.user-sub {
  font-size: 11px;
  color: var(--color-mut);
}

.user-settings {
  min-width: auto;
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
</style>
