<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { resolveFileRefPath } from "./file-ref";

const props = withDefaults(
  defineProps<{
    /** 文件/目录引用（可带行号锚点、相对路径） */
    path: string;
    kind?: "file" | "directory";
    /** 触发点的视口坐标 */
    x: number;
    y: number;
    /** 工作区根（缺省取当前会话绑定的工作区目录） */
    root?: string;
  }>(),
  { kind: "file" },
);

const emit = defineEmits<{ close: [] }>();

const menuEl = ref<HTMLElement | null>(null);
const error = ref("");
const openFolderLabel = ref("打开文件夹");
const showInFolderLabel = ref("打开到文件位置");

const MENU_MIN_W = 180;
const MENU_MIN_H = 76;
const left = computed(() => Math.max(4, Math.min(props.x, window.innerWidth - MENU_MIN_W)));
const top = computed(() => Math.max(4, Math.min(props.y, window.innerHeight - MENU_MIN_H)));

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("mousedown", onOutside, true);
  window.addEventListener("contextmenu", onOutside, true);
  window.addEventListener("resize", close);
  menuEl.value?.focus();
  void window.zen?.shell
    .platformInfo()
    .then((info) => {
      openFolderLabel.value = info.openFolderLabel || openFolderLabel.value;
      showInFolderLabel.value = info.showInFolderLabel || showInFolderLabel.value;
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("contextmenu", onOutside, true);
  window.removeEventListener("resize", close);
});

function close() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "Tab") {
    close();
  }
}

function onOutside(event: Event) {
  const target = event.target as Node | null;
  if (target && menuEl.value?.contains(target)) {
    return;
  }
  close();
}

/** 相对引用按会话工作区根绝对化；调用时才加载 store，避免组件加载牵动 chat 依赖图 */
async function absolutePath(): Promise<string> {
  if (props.root) {
    return resolveFileRefPath(props.path, props.root);
  }
  try {
    const { useChatStore } = await import("@/stores/chat");
    const { useWorkspaceStore } = await import("@/stores/workspace");
    return resolveFileRefPath(
      props.path,
      useWorkspaceStore().pathOf(useChatStore().sessionWorkspaceId),
    );
  } catch {
    return resolveFileRefPath(props.path);
  }
}

async function run(
  action: (path: string) => Promise<{ ok: boolean; error?: string } | undefined>,
) {
  const zen = window.zen;
  if (!zen) {
    error.value = "桌面环境不可用";
    return;
  }
  error.value = "";
  const result = await action(await absolutePath()).catch(
    (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  if (result?.ok) {
    close();
    return;
  }
  error.value = result?.error || "打开失败";
}

function openDefault() {
  void run((path) => window.zen!.shell.openPath(path));
}

function revealInFolder() {
  void run((path) => window.zen!.shell.showInFolder(path));
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuEl"
      class="file-context-menu"
      role="menu"
      tabindex="-1"
      :style="{ left: `${left}px`, top: `${top}px` }"
      :aria-label="`文件操作：${path}`"
      @contextmenu.prevent
    >
      <Button
        variant="ghost"
        class="file-context-menu__item"
        role="menuitem"
        @click="openDefault"
      >
        {{ kind === "directory" ? openFolderLabel : "打开文件" }}
      </Button>
      <Button
        variant="ghost"
        class="file-context-menu__item"
        role="menuitem"
        @click="revealInFolder"
      >
        {{ showInFolderLabel }}
      </Button>
      <p v-if="error" class="file-context-menu__error" role="alert">{{ error }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.file-context-menu {
  position: fixed;
  z-index: var(--z-popup);
  display: flex;
  min-width: 180px;
  max-width: min(320px, calc(100vw - 8px));
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-sm);
  background: var(--color-popover);
  box-shadow: var(--shadow-menu);
  outline: none;
}

.file-context-menu__item {
  justify-content: flex-start;
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  border-radius: 6px;
  color: var(--color-txt);
  font-size: 12.5px;
  font-weight: 400;
  white-space: nowrap;
}

.file-context-menu__item:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.file-context-menu__error {
  margin: 2px 8px 4px;
  color: var(--color-err);
  font-size: 11px;
  white-space: normal;
}
</style>
